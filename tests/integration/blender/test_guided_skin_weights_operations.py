"""Real-Blender proof for the nine-step explicit Skin Weights executor."""

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

TARGET_ID = "guided.skin.target"
HELPER_ID = "guided.skin.helper"
ARMATURE_ID = "guided.skin.rig"
MODIFIER_ID = "guided.skin.modifier"
TARGET_NAME = "OperatingLine.GuidedSkinTarget"
HELPER_NAME = "OperatingLine.GuidedSkinHelper"
ARMATURE_NAME = "OperatingLine.GuidedSkinRig"
ARMATURE_DATA_NAME = "OperatingLine.GuidedSkinRigData"
MODIFIER_NAME = "OperatingLine.GuidedSkinArmature"
ROOT_BONE = "OperatingLine.GuidedSkinRoot"
TIP_BONE = "OperatingLine.GuidedSkinTip"
STEP_ID = "guided.skin.bind"

WEIGHTS = [
    {
        "vertexIndex": index,
        "influences": [
            {
                "boneName": ROOT_BONE if index < 4 else TIP_BONE,
                "weight": 1.0,
            }
        ],
    }
    for index in range(8)
]
ARGUMENTS = {
    "targetId": TARGET_ID,
    "armatureId": ARMATURE_ID,
    "modifierId": MODIFIER_ID,
    "modifierName": MODIFIER_NAME,
    "preserveVolume": True,
    "weights": WEIGHTS,
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
            "guided.skin.target",
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": TARGET_ID,
                    "objectName": TARGET_NAME,
                    "size": 1.0,
                    "location": [0.0, 0.0, 1.0],
                },
            },
        ),
        _step(
            "guided.skin.helper",
            2,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": HELPER_ID,
                    "objectName": HELPER_NAME,
                    "size": 0.2,
                    "location": [2.0, 0.0, 1.5],
                },
            },
            depends_on=["guided.skin.target"],
        ),
        _step(
            "guided.skin.armature",
            3,
            {
                "adapterId": "blender",
                "name": "blender.rig.create_armature",
                "arguments": {
                    "armatureId": ARMATURE_ID,
                    "objectName": ARMATURE_NAME,
                    "dataName": ARMATURE_DATA_NAME,
                    "collectionId": "snowman.collection",
                    "bones": [
                        {
                            "boneName": ROOT_BONE,
                            "head": [0.0, 0.0, 0.0],
                            "tail": [0.0, 0.0, 1.0],
                            "parentName": None,
                        },
                        {
                            "boneName": TIP_BONE,
                            "head": [0.0, 0.0, 1.0],
                            "tail": [0.0, 0.0, 2.0],
                            "parentName": ROOT_BONE,
                        },
                    ],
                    "bindings": [{"targetId": HELPER_ID, "boneName": TIP_BONE}],
                },
            },
            depends_on=["guided.skin.helper"],
        ),
        _step(
            STEP_ID,
            4,
            {
                "adapterId": "blender",
                "name": "blender.rig.bind_skin_weights",
                "arguments": ARGUMENTS,
            },
            depends_on=["guided.skin.armature"],
            expected_observations=[
                {"kind": "skin_weights_ready", "parameters": ARGUMENTS}
            ],
        ),
    ],
}


def _load_extension():
    spec = importlib.util.spec_from_file_location(
        "operating_line_guided_skin_weights_integration",
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


def _assert_rna_evidence(result, ordinal: int) -> None:
    evidence = result.observation["details"]["evidence"]
    weight_mutations = evidence["rnaSkinWeightMutations"]
    modifier_mutations = evidence["rnaSkinModifierMutations"]
    assert [item["order"] for item in weight_mutations] == list(
        range(1, len(weight_mutations) + 1)
    )
    assert [item["order"] for item in modifier_mutations] == list(
        range(1, len(modifier_mutations) + 1)
    )
    if ordinal == 5:
        assert len(weight_mutations) == 12
        assert not modifier_mutations
        deform_mutations = weight_mutations[:2]
        group_mutations = weight_mutations[2:4]
        assignment_mutations = weight_mutations[4:]
        assert [item["mutationKind"] for item in deform_mutations] == [
            "armature_bone_deform_enable",
            "armature_bone_deform_enable",
        ]
        assert [item["boneName"] for item in deform_mutations] == [
            ROOT_BONE,
            TIP_BONE,
        ]
        assert [item["boneOrder"] for item in deform_mutations] == [1, 2]
        assert all(item["observedValue"] is True for item in deform_mutations)
        assert [item["mutationKind"] for item in group_mutations] == [
            "vertex_group_create",
            "vertex_group_create",
        ]
        assert [item["groupName"] for item in group_mutations] == [
            ROOT_BONE,
            TIP_BONE,
        ]
        assert [item["groupOrder"] for item in group_mutations] == [1, 2]
        assert all(item["resourceType"] == "VertexGroup" for item in group_mutations)
        assert all(
            item["mutationKind"] == "vertex_group_weight_replace"
            and item["assignmentMode"] == "REPLACE"
            and item["observedMembership"] is True
            and item["vertexOrder"] == index + 1
            and item["influenceOrder"] == 1
            and item["vertexIndex"] == index
            and math.isclose(
                item["acceptedWeight"],
                item["observedWeight"],
                rel_tol=1e-6,
                abs_tol=1e-6,
            )
            for index, item in enumerate(assignment_mutations)
        )
    else:
        assert not weight_mutations
    if ordinal == 7:
        assert [item["mutationKind"] for item in modifier_mutations] == [
            "armature_modifier_create",
            "armature_modifier_object_bind",
            "armature_modifier_property_write",
            "armature_modifier_property_write",
            "armature_modifier_property_write",
        ]
        pending_name = (
            f"OperatingLine.PendingSkinModifier."
            f"{result.observation['details']['receiptId'][:8]}"
        )
        assert all(item["targetId"] == TARGET_ID for item in modifier_mutations)
        assert all(item["armatureId"] == ARMATURE_ID for item in modifier_mutations)
        assert all(item["modifierId"] == MODIFIER_ID for item in modifier_mutations)
        assert all(
            item["pendingModifierName"] == pending_name for item in modifier_mutations
        )
        assert [item.get("propertyName") for item in modifier_mutations[2:]] == [
            "use_vertex_groups",
            "use_bone_envelopes",
            "use_deform_preserve_volume",
        ]
        assert [item.get("observedValue") for item in modifier_mutations[2:]] == [
            True,
            False,
            True,
        ]
    elif ordinal == 8:
        assert len(modifier_mutations) == 1
        mutation = modifier_mutations[0]
        assert mutation["mutationKind"] == "armature_modifier_name_write"
        assert mutation["beforeName"] == (
            f"OperatingLine.PendingSkinModifier."
            f"{result.observation['details']['receiptId'][:8]}"
        )
        assert mutation["acceptedName"] == MODIFIER_NAME
        assert mutation["observedName"] == MODIFIER_NAME
    else:
        assert not modifier_mutations


def _execute_all(session, step, snapshot, definition, operations):
    operation_ids = tuple(operation.operation_id for operation in snapshot.operations)
    run = session.begin_leaf_operation_run(
        step,
        recipe_id=snapshot.recipe_id,
        catalog_version=snapshot.catalog_version,
        operation_ids=operation_ids,
    )
    transaction = None
    for ordinal in range(1, 10):
        result = operations.execute_skin_weights_operation(
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
        mutating = ordinal in operations.SKIN_WEIGHTS_MUTATING_ORDINALS
        assert result.observation["details"]["mutating"] is mutating
        assert (result.before_fingerprint != result.after_fingerprint) is mutating
        assert operations.verify_skin_weights_stage(
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            completed_operations=tuple(range(1, ordinal + 1)),
            expected_fingerprint=result.after_fingerprint,
            partial_receipt=run.partial_action_receipt,
        )
        if ordinal in {5, 7, 8, 9}:
            inverse = operations.inverse_skin_weights_operation(
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
                partial_action_receipt=(None if ordinal <= 5 else inverse.receipt),
            )
            replay = operations.execute_skin_weights_operation(
                operation_ordinal=ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=transaction,
            )
            expected_before = (
                run.operation_receipts[-1].after_sha256
                if run.operation_receipts
                else replay.before_fingerprint
            )
            assert replay.before_fingerprint == expected_before
            _assert_rna_evidence(replay, ordinal)
            transaction = replay.transaction
            run = _record(session, step, run, operation_ids, ordinal, replay)
    return run, transaction, operation_ids


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _load_extension()

    from operating_line_guided_skin_weights_integration.operating_line.application import (
        DemoSession,
        MenuGuidanceTracker,
    )
    from operating_line_guided_skin_weights_integration.operating_line.domain import (
        load_task_tree_data,
    )
    from operating_line_guided_skin_weights_integration.operating_line.infrastructure import (
        action_registry,
    )
    from operating_line_guided_skin_weights_integration.operating_line.infrastructure import (
        guided_skin_weights_operations as operations,
    )
    from operating_line_guided_skin_weights_integration.operating_line.infrastructure.observations import (
        evaluate_observations,
    )
    from operating_line_guided_skin_weights_integration.operating_line.infrastructure.snowman_actions.rigging import (
        validate_skin_weights,
    )

    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="guided-skin-weights-operations-integration",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    session.start()
    assert session.next().id == "guided.skin.target"
    assert session.next().id == "guided.skin.helper"
    assert session.next().id == "guided.skin.armature"
    step = session.guidance_step
    assert step is not None and step.id == STEP_ID
    snapshot = MenuGuidanceTracker().snapshot(step)
    assert snapshot is not None
    assert snapshot.recipe_id == "blender.rig.bind_skin_weights.semantic"
    assert snapshot.catalog_version == "1.69.0"
    assert tuple(
        operation.operation_id for operation in snapshot.operations
    ) == operations.SKIN_WEIGHTS_OPERATION_IDS
    definition = validate_skin_weights(step.action.arguments)

    run, transaction, operation_ids = _execute_all(
        session, step, snapshot, definition, operations
    )
    target = bpy.data.objects[TARGET_NAME]
    armature = bpy.data.objects[ARMATURE_NAME]
    assert tuple(group.name for group in target.vertex_groups) == (
        ROOT_BONE,
        TIP_BONE,
    )
    assert all(bone.use_deform for bone in armature.data.bones)
    assert len(target.modifiers) == 1
    modifier = target.modifiers[0]
    assert modifier.name == MODIFIER_NAME
    assert modifier.type == "ARMATURE"
    assert modifier.object is armature
    assert modifier.use_vertex_groups is True
    assert modifier.use_bone_envelopes is False
    assert modifier.use_deform_preserve_volume is True

    for ordinal in range(9, 0, -1):
        inverse = operations.inverse_skin_weights_operation(
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
            partial_action_receipt=(None if ordinal <= 5 else inverse.receipt),
        )
    assert transaction.completed_operations == ()
    assert len(target.vertex_groups) == 0
    assert len(target.modifiers) == 0
    assert all(not bone.use_deform for bone in armature.data.bones)
    assert session.pending_leaf_operation_run is None

    run, _transaction, _operation_ids = _execute_all(
        session, step, snapshot, definition, operations
    )
    partial_receipt = run.partial_action_receipt
    completed = session.complete_leaf_operation_run(step, run_id=run.run_id)
    assert completed.status == "completed"
    assert len(completed.operation_receipts) == 9
    assert session.receipts[step.id] == partial_receipt
    observations = session.success_gate_observation_copy(step.id)
    assert observations is not None and observations[0]["satisfied"] is True
    assert observations[0]["kind"] == "skin_weights_ready"
    assert observations[0]["details"]["assignmentMatches"] is True
    assert observations[0]["details"]["modifierMatches"] is True

    assert session.back() is step
    assert len(target.vertex_groups) == 0
    assert len(target.modifiers) == 0
    assert all(not bone.use_deform for bone in armature.data.bones)
    print(
        "OperatingLine guided Skin Weights proof passed: "
        "9 forward + 9 inverse + replay + completion",
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
