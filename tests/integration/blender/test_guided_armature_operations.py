"""Real-Blender proof for the nine-step Armature executor."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import traceback

import bpy


sys.dont_write_bytecode = True
REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"

TARGET_ID = "guided.armature.target"
ARMATURE_ID = "guided.armature.rig"
OBJECT_NAME = "OperatingLine.GuidedArmatureRig"
DATA_NAME = "OperatingLine.GuidedArmatureRigData"
ROOT_BONE = "OperatingLine.GuidedArmatureRoot"
TIP_BONE = "OperatingLine.GuidedArmatureTip"
STEP_ID = "guided.armature.create"

ARGUMENTS = {
    "armatureId": ARMATURE_ID,
    "objectName": OBJECT_NAME,
    "dataName": DATA_NAME,
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
            "tail": [0.25, 0.0, 2.0],
            "parentName": ROOT_BONE,
        },
    ],
    "bindings": [{"targetId": TARGET_ID, "boneName": TIP_BONE}],
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
            "guided.armature.target",
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": TARGET_ID,
                    "objectName": "OperatingLine.GuidedArmatureTarget",
                    "size": 0.4,
                    "location": [1.5, 0.0, 1.5],
                },
            },
        ),
        _step(
            STEP_ID,
            2,
            {
                "adapterId": "blender",
                "name": "blender.rig.create_armature",
                "arguments": ARGUMENTS,
            },
            depends_on=["guided.armature.target"],
            expected_observations=[
                {"kind": "armature_ready", "parameters": ARGUMENTS}
            ],
        ),
    ],
}


def _load_extension():
    spec = importlib.util.spec_from_file_location(
        "operating_line_guided_armature_integration",
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
        partial_action_receipt=None if ordinal < 2 else result.receipt,
    )


def _assert_rna_evidence(ordinal, receipt_id, evidence):
    resources = evidence["rnaArmatureResourceMutations"]
    bones = evidence["rnaArmatureBoneMutations"]
    bindings = evidence["rnaArmatureBindingMutations"]
    assert [item["order"] for item in resources] == list(
        range(1, len(resources) + 1)
    )
    assert [item["order"] for item in bones] == list(range(1, len(bones) + 1))
    assert [item["order"] for item in bindings] == list(
        range(1, len(bindings) + 1)
    )
    if ordinal == 2:
        assert [item["mutationKind"] for item in resources] == [
            "armature_data_create",
            "armature_object_create",
            "collection_object_link",
        ]
        assert resources[0]["pendingDataName"] == (
            f"OperatingLine.PendingArmatureData.{receipt_id[:8]}"
        )
        assert resources[1]["pendingObjectName"] == (
            f"OperatingLine.PendingArmatureObject.{receipt_id[:8]}"
        )
    elif ordinal == 3:
        assert resources[0]["mutationKind"] == "armature_object_name_write"
        assert resources[0]["acceptedName"] == OBJECT_NAME
        assert resources[0]["observedName"] == OBJECT_NAME
    elif ordinal == 4:
        assert resources[0]["mutationKind"] == "armature_data_name_write"
        assert resources[0]["acceptedName"] == DATA_NAME
        assert resources[0]["observedName"] == DATA_NAME
    else:
        assert resources == []
    if ordinal == 6:
        assert [item["mutationKind"] for item in bones] == [
            "edit_bone_create",
            "edit_bone_create",
            "edit_bone_parent_bind",
            "pose_bone_rotation_mode_write",
            "pose_bone_rotation_mode_write",
        ]
        assert bones[0]["acceptedHead"] == ARGUMENTS["bones"][0]["head"]
        assert bones[1]["acceptedTail"] == ARGUMENTS["bones"][1]["tail"]
        assert bones[2]["observedParentName"] == ROOT_BONE
        assert all(
            item.get("observedRotationMode") == "XYZ" for item in bones[-2:]
        )
    else:
        assert bones == []
    if ordinal == 8:
        assert len(bindings) == 1
        assert bindings[0]["targetId"] == TARGET_ID
        assert bindings[0]["armatureId"] == ARMATURE_ID
        assert bindings[0]["observedParentBone"] == TIP_BONE
        assert bindings[0]["observedWorldMatrixPreserved"] is True
    else:
        assert bindings == []


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
        result = operations.execute_armature_operation(
            operation_ordinal=ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = result.transaction
        _assert_rna_evidence(
            ordinal,
            run.leaf_receipt_id,
            result.observation["details"]["evidence"],
        )
        run = _record(session, step, run, operation_ids, ordinal, result)
        mutating = ordinal in operations.ARMATURE_MUTATING_ORDINALS
        assert result.observation["details"]["mutating"] is mutating
        assert (result.before_fingerprint != result.after_fingerprint) is mutating
        assert operations.verify_armature_stage(
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            completed_operations=tuple(range(1, ordinal + 1)),
            expected_fingerprint=result.after_fingerprint,
            partial_receipt=run.partial_action_receipt,
        )
        if ordinal in {2, 3, 4, 6, 8, 9}:
            inverse = operations.inverse_armature_operation(
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
                partial_action_receipt=(None if ordinal <= 2 else inverse.receipt),
            )
            replay = operations.execute_armature_operation(
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
            assert replay.before_fingerprint == expected_before, (
                ordinal,
                replay.before_fingerprint,
                expected_before,
            )
            _assert_rna_evidence(
                ordinal,
                run.leaf_receipt_id,
                replay.observation["details"]["evidence"],
            )
            transaction = replay.transaction
            run = _record(session, step, run, operation_ids, ordinal, replay)
    return run, transaction, operation_ids


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _load_extension()

    from operating_line_guided_armature_integration.operating_line.application import (
        DemoSession,
        MenuGuidanceTracker,
    )
    from operating_line_guided_armature_integration.operating_line.domain import (
        load_task_tree_data,
    )
    from operating_line_guided_armature_integration.operating_line.infrastructure import (
        action_registry,
    )
    from operating_line_guided_armature_integration.operating_line.infrastructure import (
        guided_armature_operations as operations,
    )
    from operating_line_guided_armature_integration.operating_line.infrastructure.observations import (
        evaluate_observations,
    )
    from operating_line_guided_armature_integration.operating_line.infrastructure.snowman_actions.rigging import (
        validate_armature,
    )

    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="guided-armature-operations-integration",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    session.start()
    assert session.next().id == "guided.armature.target"
    step = session.guidance_step
    assert step is not None and step.id == STEP_ID
    snapshot = MenuGuidanceTracker().snapshot(step)
    assert snapshot is not None
    assert snapshot.recipe_id == "blender.rig.create_armature.semantic"
    assert snapshot.catalog_version == "1.69.0"
    assert tuple(
        operation.operation_id for operation in snapshot.operations
    ) == operations.ARMATURE_OPERATION_IDS
    definition = validate_armature(step.action.arguments)

    run, transaction, operation_ids = _execute_all(
        session, step, snapshot, definition, operations
    )
    armature = bpy.data.objects[OBJECT_NAME]
    target = bpy.data.objects["OperatingLine.GuidedArmatureTarget"]
    assert armature.type == "ARMATURE"
    assert armature.data.name == DATA_NAME
    assert tuple(bone.name for bone in armature.data.bones) == (ROOT_BONE, TIP_BONE)
    assert target.parent is armature
    assert target.parent_type == "BONE"
    assert target.parent_bone == TIP_BONE

    for ordinal in range(9, 0, -1):
        inverse = operations.inverse_armature_operation(
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
            partial_action_receipt=(None if ordinal <= 2 else inverse.receipt),
        )
    assert transaction.completed_operations == ()
    assert bpy.data.objects.get(OBJECT_NAME) is None
    assert target.parent is None
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
    assert observations[0]["kind"] == "armature_ready"
    assert observations[0]["details"]["bonesMatch"] is True
    assert observations[0]["details"]["bindingsMatch"] is True

    assert session.back() is step
    assert bpy.data.objects.get(OBJECT_NAME) is None
    assert target.parent is None
    print(
        "OperatingLine guided Armature proof passed: "
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
