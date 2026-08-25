"""Operation-level execution for the bounded Poke Faces guide leaf."""

from __future__ import annotations

from dataclasses import replace
import hashlib
from types import SimpleNamespace
from typing import Any, Mapping

from .guided_geometry_operations import (
    GuidedGeometryAtomicityError,
    GuidedGeometryOperationResult,
    GuidedGeometryTransaction,
)


EDIT_POKE_ACTION = "blender.mesh.edit_poke_faces"
EDIT_POKE_OPERATION_IDS = (
    "workspace.layout",
    "semantic.select_owned_mesh",
    "mode.edit_mesh",
    "menu.face",
    "operator.poke_faces",
    "semantic.managed_poke_faces_contract",
)
EDIT_POKE_MUTATING_ORDINALS = frozenset({5, 6})
_EDIT_POKE_EXECUTE_TOOL = (
    "operatingline.blender.mesh.edit-poke-faces.execute-next"
)
_FIXED_POKE_PARAMETERS = {
    "centerMode": "MEAN_WEIGHTED",
    "useRelativeOffset": False,
}


def _dependencies() -> SimpleNamespace:
    from ..application.session import MutationRecord
    from .snowman_actions.common import (
        build_resource_registry,
        ensure_logical_ids_available,
        ensure_name_available,
        ensure_receipts_intact,
        journal_created_resource,
        make_receipt,
        mesh_content_signature,
        owned_resource,
        rebind_receipts_after_native_restore,
        resolve_resource,
        rollback_partial,
        rollback_receipt,
    )
    from .snowman_actions.editing import (
        _edit_poke_result_is_finite_and_nondegenerate,
        _ensure_edit_poke_topology_is_bounded,
        _validate_edit_poke_source,
    )

    return SimpleNamespace(
        MutationRecord=MutationRecord,
        build_resource_registry=build_resource_registry,
        edit_poke_result_is_finite_and_nondegenerate=(
            _edit_poke_result_is_finite_and_nondegenerate
        ),
        ensure_edit_poke_topology_is_bounded=_ensure_edit_poke_topology_is_bounded,
        ensure_logical_ids_available=ensure_logical_ids_available,
        ensure_name_available=ensure_name_available,
        ensure_receipts_intact=ensure_receipts_intact,
        journal_created_resource=journal_created_resource,
        make_receipt=make_receipt,
        mesh_content_signature=mesh_content_signature,
        owned_resource=owned_resource,
        rebind_receipts_after_native_restore=rebind_receipts_after_native_restore,
        resolve_resource=resolve_resource,
        rollback_partial=rollback_partial,
        rollback_receipt=rollback_receipt,
        validate_edit_poke_source=_validate_edit_poke_source,
    )


def _bpy() -> Any:
    import bpy

    return bpy


def _bmesh() -> Any:
    import bmesh

    return bmesh


def _digest(value: Any) -> str:
    return hashlib.sha256(repr(value).encode("utf-8")).hexdigest()


def _definition_fingerprint(definition: Any) -> str:
    return _digest(
        (
            definition.target_id,
            definition.result_mesh_id,
            definition.result_mesh_name,
            float(definition.offset),
        )
    )


def _pending_result_mesh_name(receipt_id: str) -> str:
    return f"OperatingLine.PendingEditPokeMesh.{receipt_id[:8]}"


def _empty_receipt(
    receipt_id: str,
    step_id: str,
    action_name: str,
    target_identity: Any,
    deps: Any,
) -> Any:
    return deps.make_receipt(
        receipt_id,
        step_id,
        action_name,
        [],
        [],
        [],
        target_identity,
    )


def _source_resources(
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
    receipt: Any | None = None,
) -> tuple[Any, Any, Any, Any]:
    registry = deps.build_resource_registry(receipts)
    target_identity, target = deps.owned_resource(
        registry, definition.target_id, "OBJECT"
    )
    if getattr(target, "type", None) != "MESH":
        raise ValueError(
            f"Edit Poke target is not an owned mesh: {definition.target_id}"
        )
    data_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.attribute == "data"
            and mutation.resource == target_identity
        )
        if receipt is not None
        else ()
    )
    if len(data_mutations) > 1:
        raise RuntimeError("Partial Edit Poke has ambiguous Object data mutations")
    source_identity = (
        data_mutations[0].before
        if data_mutations
        else next(
            (
                identity
                for identity in registry.values()
                if identity.resource_type == "MESH"
                and deps.resolve_resource(identity) is target.data
            ),
            None,
        )
    )
    if source_identity is None or source_identity not in registry.values():
        raise RuntimeError("Owned Edit Poke source mesh identity is unavailable")
    source_mesh = deps.resolve_resource(source_identity)
    if source_mesh is None:
        raise RuntimeError("Owned Edit Poke source mesh binding changed")
    return target_identity, target, source_identity, source_mesh


def _validate_source_state(
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
    receipt: Any | None = None,
) -> tuple[Any, Any, Any, Any, tuple[int, int, int], int]:
    validation_receipts = receipts
    if receipt is not None and any(
        mutation.attribute == "data" for mutation in receipt.mutations
    ):
        validation_receipts = dict(receipts)
        validation_receipts["__guided_edit_poke_partial__"] = receipt
    deps.ensure_receipts_intact(validation_receipts)
    target_identity, target, source_identity, source_mesh = _source_resources(
        receipts, definition, deps, receipt
    )
    if target.mode != "OBJECT":
        raise RuntimeError(
            "Managed Edit Poke keeps its replacement transaction in Object Mode"
        )
    if target.modifiers:
        raise RuntimeError("Edit Poke target must not have modifiers")
    if source_mesh.shape_keys is not None:
        raise RuntimeError("Edit Poke target must not have shape keys")
    source_topology, source_loop_count = deps.validate_edit_poke_source(source_mesh)
    return (
        target_identity,
        target,
        source_identity,
        source_mesh,
        source_topology,
        source_loop_count,
    )


def _validate_base_state(
    receipts: Mapping[str, Any], definition: Any, receipt_id: str, deps: Any
) -> tuple[Any, Any, Any, Any, tuple[int, int, int], int]:
    resources = _validate_source_state(receipts, definition, deps)
    registry = deps.build_resource_registry(receipts)
    deps.ensure_logical_ids_available(registry, (definition.result_mesh_id,))
    deps.ensure_name_available(
        _bpy().data.meshes, definition.result_mesh_name, "mesh"
    )
    deps.ensure_name_available(
        _bpy().data.meshes,
        _pending_result_mesh_name(receipt_id),
        "pending mesh",
    )
    return resources


def _replace_value(value: Any, old: Any, new: Any) -> Any:
    if value == old:
        return new
    if isinstance(value, tuple):
        return tuple(_replace_value(item, old, new) for item in value)
    if isinstance(value, list):
        return [_replace_value(item, old, new) for item in value]
    if isinstance(value, dict):
        return {key: _replace_value(item, old, new) for key, item in value.items()}
    return value


def _replace_identity(receipt: Any, old: Any, new: Any, deps: Any) -> Any:
    return replace(
        receipt,
        created=tuple(_replace_value(item, old, new) for item in receipt.created),
        mutations=tuple(
            deps.MutationRecord(
                _replace_value(mutation.resource, old, new),
                mutation.attribute,
                _replace_value(mutation.before, old, new),
                _replace_value(mutation.after, old, new),
            )
            for mutation in receipt.mutations
        ),
        anchor=_replace_value(receipt.anchor, old, new),
    )


def _result_identity(receipt: Any, definition: Any) -> Any:
    matches = tuple(
        identity
        for identity in receipt.created
        if identity.resource_type == "MESH"
        and identity.logical_id == definition.result_mesh_id
    )
    if len(matches) != 1:
        raise RuntimeError("Partial Edit Poke receipt must own one result Mesh")
    return matches[0]


def _result_resources(receipt: Any, definition: Any, deps: Any) -> tuple[Any, Any]:
    identity = _result_identity(receipt, definition)
    result_mesh = deps.resolve_resource(identity)
    if result_mesh is None:
        raise RuntimeError("Partial Edit Poke result Mesh is unavailable")
    return identity, result_mesh


def _combined_receipts(receipts: Mapping[str, Any], receipt: Any) -> dict[str, Any]:
    combined = dict(receipts)
    combined["__guided_edit_poke_partial__"] = receipt
    return combined


def _topology(mesh: Any) -> tuple[int, int, int]:
    return (len(mesh.vertices), len(mesh.edges), len(mesh.polygons))


def _fingerprint(
    receipts: Mapping[str, Any], receipt: Any, definition: Any, stage: int, deps: Any
) -> str:
    _bpy().context.view_layer.update()
    (
        target_identity,
        target,
        source_identity,
        source_mesh,
        source_topology,
        source_loop_count,
    ) = (
        _validate_source_state(receipts, definition, deps, receipt)
    )
    result_state = None
    target_data_id = source_identity.logical_id
    if stage >= 5:
        result_identity, result_mesh = _result_resources(receipt, definition, deps)
        result_state = (
            result_identity.display_name,
            deps.mesh_content_signature(result_mesh),
            _topology(result_mesh),
        )
        if target.data is result_mesh:
            target_data_id = result_identity.logical_id
    return _digest(
        (
            (target_identity.logical_id, target.name, target.mode, target_data_id),
            (
                source_identity.logical_id,
                source_mesh.name,
                source_topology,
                source_loop_count,
            ),
            deps.mesh_content_signature(source_mesh),
            result_state,
        )
    )


def _validate_stage(
    receipts: Mapping[str, Any],
    receipt: Any,
    definition: Any,
    completed_operations: tuple[int, ...],
    deps: Any,
) -> tuple[Any, Any, Any, Any, int, Any | None, Any | None]:
    stage = completed_operations[-1] if completed_operations else 0
    (
        target_identity,
        target,
        source_identity,
        source_mesh,
        source_topology,
        source_loop_count,
    ) = (
        _validate_source_state(receipts, definition, deps, receipt)
    )
    if receipt.anchor != target_identity or receipt.artifacts:
        raise RuntimeError("Partial Edit Poke receipt binding changed")
    if stage < 5:
        _validate_base_state(receipts, definition, receipt.receipt_id, deps)
        if receipt.created or receipt.mutations:
            raise RuntimeError("Edit Poke pre-mutation receipt changed")
        return (
            target,
            source_mesh,
            source_identity,
            source_topology,
            source_loop_count,
            None,
            None,
        )

    combined = _combined_receipts(receipts, receipt)
    deps.ensure_receipts_intact(combined)
    result_identity, result_mesh = _result_resources(receipt, definition, deps)
    result_topology = _topology(result_mesh)
    deps.ensure_edit_poke_topology_is_bounded(result_topology, "partial result")
    expected_topology = (
        source_topology[0] + source_topology[2],
        source_topology[1] + source_loop_count,
        source_loop_count,
    )
    if result_topology != expected_topology:
        raise RuntimeError("Partial Edit Poke result topology changed")
    content_mutations = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.attribute == "mesh_content"
        and mutation.resource == result_identity
        and mutation.before is None
    )
    source_content_mutations = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.attribute == "mesh_content"
        and mutation.resource == source_identity
        and mutation.before == mutation.after
        and mutation.before is not None
    )
    data_mutations = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.attribute == "data" and mutation.resource == target_identity
    )
    expected_name = (
        _pending_result_mesh_name(receipt.receipt_id)
        if stage == 5
        else definition.result_mesh_name
    )
    checks = {
        "created": receipt.created == (result_identity,),
        "result_name": result_mesh.name == expected_name,
        "identity_name": result_identity.display_name == expected_name,
        "result_content": len(content_mutations) == 1
        and content_mutations[0].after == deps.mesh_content_signature(result_mesh),
        "source_content": len(source_content_mutations) == 1
        and source_content_mutations[0].after
        == deps.mesh_content_signature(source_mesh),
        "data_mutation_count": len(data_mutations) == (1 if stage >= 6 else 0),
        "mutation_count": len(receipt.mutations) == (3 if stage >= 6 else 2),
        "source_link": stage >= 6 or target.data is source_mesh,
        "result_link": stage < 6 or target.data is result_mesh,
        "data_before": stage < 6 or data_mutations[0].before == source_identity,
        "data_after": stage < 6 or data_mutations[0].after == result_identity,
    }
    failed = tuple(name for name, passed in checks.items() if not passed)
    if failed:
        raise RuntimeError(
            "Partial Edit Poke result state changed: " + ", ".join(failed)
        )
    return (
        target,
        source_mesh,
        source_identity,
        source_topology,
        source_loop_count,
        result_identity,
        result_mesh,
    )


def _create_poke_mesh(
    receipt: Any,
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    (
        target_identity,
        _target,
        source_identity,
        source_mesh,
        source_topology,
        source_loop_count,
    ) = _validate_base_state(receipts, definition, receipt.receipt_id, deps)
    expected_topology = (
        source_topology[0] + source_topology[2],
        source_topology[1] + source_loop_count,
        source_loop_count,
    )
    deps.ensure_edit_poke_topology_is_bounded(expected_topology, "result")
    pending_name = _pending_result_mesh_name(receipt.receipt_id)
    created: list[Any] = []
    mutations: list[Any] = []
    result_mesh = None
    bm = None
    try:
        result_mesh = source_mesh.copy()
        result_mesh.name = pending_name
        result_identity = deps.journal_created_resource(
            created,
            result_mesh,
            definition.result_mesh_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
        )
        bm = _bmesh().new()
        bm.from_mesh(result_mesh)
        _bmesh().ops.poke(
            bm,
            faces=tuple(bm.faces),
            offset=definition.offset,
            center_mode="MEAN_WEIGHTED",
            use_relative_offset=False,
        )
        bm.normal_update()
        predicted_topology = (len(bm.verts), len(bm.edges), len(bm.faces))
        deps.ensure_edit_poke_topology_is_bounded(
            predicted_topology, "projected result"
        )
        if predicted_topology != expected_topology:
            raise RuntimeError(
                "Edit Poke topology does not match the supported exact formula"
            )
        if any(len(face.verts) != 3 for face in bm.faces):
            raise RuntimeError("Edit Poke did not produce only triangle faces")
        if not deps.edit_poke_result_is_finite_and_nondegenerate(bm):
            raise RuntimeError("Edit Poke produced degenerate or non-finite geometry")
        bm.to_mesh(result_mesh)
        bm.free()
        bm = None
        result_mesh.update()
        actual_topology = _topology(result_mesh)
        deps.ensure_edit_poke_topology_is_bounded(actual_topology, "actual result")
        if actual_topology != predicted_topology:
            raise RuntimeError("Edit Poke topology changed during mesh conversion")
        if any(len(face.vertices) != 3 for face in result_mesh.polygons):
            raise RuntimeError("Edit Poke mesh conversion produced non-triangle faces")
        source_content = deps.mesh_content_signature(source_mesh)
        mutations.append(
            deps.MutationRecord(
                source_identity,
                "mesh_content",
                source_content,
                source_content,
            )
        )
        mutations.append(
            deps.MutationRecord(
                result_identity,
                "mesh_content",
                None,
                deps.mesh_content_signature(result_mesh),
            )
        )
        receipt = deps.make_receipt(
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            created,
            mutations,
            [],
            target_identity,
        )
        fixed_parameters = dict(_FIXED_POKE_PARAMETERS)
        evidence = (
            {
                "order": 1,
                "executionMethod": "blender_rna_mesh_copy",
                "mcpTool": _EDIT_POKE_EXECUTE_TOOL,
                "sourceOperationId": EDIT_POKE_OPERATION_IDS[4],
                "semanticAction": EDIT_POKE_OPERATION_IDS[4],
                "valueSource": "managed_receipt_identity",
                "mutationKind": "edit_poke_mesh_create",
                "targetId": definition.target_id,
                "resultMeshId": definition.result_mesh_id,
                "pendingResultMeshName": pending_name,
                "resourceType": result_mesh.bl_rna.identifier,
                "observedResource": True,
                "uiPath": [
                    "OperatingLine",
                    "Guided Control",
                    "Poke Faces",
                    "Result Mesh",
                    pending_name,
                ],
            },
            {
                "order": 2,
                "executionMethod": "blender_bmesh_poke_argument_projection",
                "mcpTool": _EDIT_POKE_EXECUTE_TOOL,
                "sourceOperationId": EDIT_POKE_OPERATION_IDS[4],
                "semanticAction": EDIT_POKE_OPERATION_IDS[4],
                "valueSource": "accepted_action_argument",
                "actionArgument": "offset",
                "mutationKind": "edit_poke_parameter_projection",
                "targetId": definition.target_id,
                "resultMeshId": definition.result_mesh_id,
                "parameterName": "offset",
                "acceptedValue": definition.offset,
                "projectedValue": definition.offset,
                "uiPath": ["Adjust Last Operation", "Offset"],
            },
            {
                "order": 3,
                "executionMethod": "blender_bmesh_ops_poke",
                "mcpTool": _EDIT_POKE_EXECUTE_TOOL,
                "sourceOperationId": EDIT_POKE_OPERATION_IDS[4],
                "semanticAction": EDIT_POKE_OPERATION_IDS[4],
                "valueSource": "accepted_action_and_catalog_constants",
                "mutationKind": "edit_poke_mesh_content_write",
                "targetId": definition.target_id,
                "resultMeshId": definition.result_mesh_id,
                "fixedParameters": fixed_parameters,
                "sourceTopology": list(source_topology),
                "sourceLoopCount": source_loop_count,
                "expectedTopology": list(expected_topology),
                "resultTopology": list(actual_topology),
                "sourceContentPreserved": True,
                "resultContentObserved": True,
                "allTriangles": True,
                "resultNondegenerate": True,
                "uiPath": [
                    "OperatingLine",
                    "Guided Control",
                    "Poke Faces",
                    "Apply BMesh Poke Faces",
                ],
            },
        )
        return receipt, evidence
    except Exception:
        if bm is not None:
            bm.free()
        if created or mutations:
            deps.rollback_partial(
                receipt.receipt_id,
                receipt.step_id,
                receipt.action_name,
                created,
                mutations,
                [],
            )
        elif result_mesh is not None:
            _bpy().data.meshes.remove(result_mesh)
        raise


def _rename_result_mesh(receipt: Any, definition: Any, name: str, deps: Any) -> Any:
    old_identity, result_mesh = _result_resources(receipt, definition, deps)
    result_mesh.name = name
    new_identity = replace(old_identity, display_name=result_mesh.name)
    return _replace_identity(receipt, old_identity, new_identity, deps)


def _apply_managed_contract(
    receipt: Any, receipts: Mapping[str, Any], definition: Any, deps: Any
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    (
        target,
        source_mesh,
        source_identity,
        _source_topology,
        _source_loop_count,
        _result_identity_value,
        result_mesh,
    ) = _validate_stage(receipts, receipt, definition, (1, 2, 3, 4, 5), deps)
    if result_mesh is None:
        raise RuntimeError("Partial Edit Poke result Mesh is unavailable")
    deps.ensure_name_available(
        _bpy().data.meshes, definition.result_mesh_name, "mesh"
    )
    before_name = result_mesh.name
    try:
        receipt = _rename_result_mesh(
            receipt, definition, definition.result_mesh_name, deps
        )
        result_identity, result_mesh = _result_resources(receipt, definition, deps)
        target_identity = receipt.anchor
        target.data = result_mesh
        receipt = replace(
            receipt,
            mutations=(
                *receipt.mutations,
                deps.MutationRecord(
                    target_identity,
                    "data",
                    source_identity,
                    result_identity,
                ),
            ),
        )
        if target.data is not result_mesh or result_mesh.name != definition.result_mesh_name:
            raise RuntimeError("Edit Poke managed link readback changed")
        evidence = (
            {
                "order": 1,
                "executionMethod": "blender_rna_mesh_name_write",
                "mcpTool": _EDIT_POKE_EXECUTE_TOOL,
                "sourceOperationId": EDIT_POKE_OPERATION_IDS[5],
                "semanticAction": EDIT_POKE_OPERATION_IDS[5],
                "valueSource": "accepted_action_argument",
                "actionArgument": "resultMeshName",
                "mutationKind": "edit_poke_mesh_name_write",
                "targetId": definition.target_id,
                "resultMeshId": definition.result_mesh_id,
                "beforeName": before_name,
                "acceptedName": definition.result_mesh_name,
                "observedName": result_mesh.name,
                "uiPath": [
                    "OperatingLine",
                    "Guided Control",
                    "Poke Faces",
                    "Result Mesh Name",
                ],
            },
            {
                "order": 2,
                "executionMethod": "blender_rna_object_data_link_write",
                "mcpTool": _EDIT_POKE_EXECUTE_TOOL,
                "sourceOperationId": EDIT_POKE_OPERATION_IDS[5],
                "semanticAction": EDIT_POKE_OPERATION_IDS[5],
                "valueSource": "managed_receipt_identity",
                "mutationKind": "edit_poke_object_data_link_write",
                "targetId": definition.target_id,
                "resultMeshId": definition.result_mesh_id,
                "sourceMeshLogicalId": source_identity.logical_id,
                "resultMeshLogicalId": result_identity.logical_id,
                "observedLink": True,
                "uiPath": [
                    "OperatingLine",
                    "Guided Control",
                    "Poke Faces",
                    "Object Data Link",
                ],
            },
        )
        return receipt, evidence
    except Exception as error:
        try:
            target.data = source_mesh
            result_mesh.name = before_name
            if target.data is not source_mesh or result_mesh.name != before_name:
                raise RuntimeError("Edit Poke contract state was not restored")
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                "Edit Poke contract failed and its prior state was not restored"
            ) from recovery_error
        raise error


def _reset_managed_contract(
    receipt: Any, receipts: Mapping[str, Any], definition: Any, deps: Any
) -> Any:
    (
        target,
        source_mesh,
        _source_identity,
        _source_topology,
        _source_loop_count,
        result_identity,
        result_mesh,
    ) = _validate_stage(receipts, receipt, definition, (1, 2, 3, 4, 5, 6), deps)
    if result_identity is None or result_mesh is None:
        raise RuntimeError("Completed Edit Poke result Mesh is unavailable")
    accepted_name = result_mesh.name
    pending_name = _pending_result_mesh_name(receipt.receipt_id)
    try:
        target.data = source_mesh
        receipt = _rename_result_mesh(receipt, definition, pending_name, deps)
        receipt = replace(
            receipt,
            mutations=tuple(
                mutation
                for mutation in receipt.mutations
                if not (
                    mutation.attribute == "data"
                    and mutation.resource == receipt.anchor
                )
            ),
        )
        return receipt
    except Exception as error:
        try:
            current_identity, current_result = _result_resources(
                receipt, definition, deps
            )
            current_result.name = accepted_name
            restored_identity = replace(
                current_identity, display_name=current_result.name
            )
            receipt = _replace_identity(
                receipt, current_identity, restored_identity, deps
            )
            target.data = current_result
            if target.data is not current_result or current_result.name != accepted_name:
                raise RuntimeError("Edit Poke completed state was not restored")
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                "Edit Poke inverse failed and the completed state was not restored"
            ) from recovery_error
        raise error


def _remove_result_mesh(receipt: Any, definition: Any, deps: Any) -> Any:
    _result_identity(receipt, definition)
    target_identity = receipt.anchor
    deps.rollback_receipt(receipt, allow_incomplete=True)
    return _empty_receipt(
        receipt.receipt_id,
        receipt.step_id,
        receipt.action_name,
        target_identity,
        deps,
    )


def _observation(
    *,
    ordinal: int,
    direction: str,
    receipt: Any,
    before: str,
    after: str,
    definition: Any,
    completed: tuple[int, ...],
    edit_poke_mesh_operations: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    stage = completed[-1] if completed else 0
    return {
        "kind": "guided_edit_mesh_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": direction,
            "operationOrdinal": ordinal,
            "operationId": EDIT_POKE_OPERATION_IDS[ordinal - 1],
            "mutating": ordinal in EDIT_POKE_MUTATING_ORDINALS,
            "receiptId": receipt.receipt_id,
            "stepId": receipt.step_id,
            "actionName": receipt.action_name,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(completed),
                "preconditionsValidated": ordinal == 1,
                "completeEditPokeFaces": ordinal == len(EDIT_POKE_OPERATION_IDS),
                "stage": min(stage, len(EDIT_POKE_OPERATION_IDS)),
                "targetId": definition.target_id,
                "resultMeshId": definition.result_mesh_id,
                "resultMeshCreated": stage >= 5,
                "meshContentApplied": stage >= 5,
                "resultLinked": stage >= 6,
                "resolvedResultMeshName": (
                    definition.result_mesh_name if stage >= 6 else None
                ),
                "editPokeMeshOperations": list(edit_poke_mesh_operations),
            },
        },
    }


def resume_edit_poke_transaction(
    *,
    receipt: Any,
    completed_operations: tuple[int, ...],
    fingerprint: str,
    definition: Any,
) -> GuidedGeometryTransaction:
    if not completed_operations or completed_operations != tuple(
        range(1, len(completed_operations) + 1)
    ):
        raise ValueError("completed_operations must be a non-empty ordinal prefix")
    if receipt is None or not isinstance(fingerprint, str) or len(fingerprint) != 64:
        raise ValueError(
            "A resumed Edit Poke transaction requires its receipt and fingerprint"
        )
    return GuidedGeometryTransaction(
        receipt,
        completed_operations,
        fingerprint,
        _definition_fingerprint(definition),
    )


def _validate_transaction(
    transaction: GuidedGeometryTransaction,
    receipt_id: str,
    step_id: str,
    action_name: str,
    completed_operations: tuple[int, ...],
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
) -> None:
    if (
        transaction.completed_operations != completed_operations
        or transaction.definition_fingerprint != _definition_fingerprint(definition)
        or transaction.receipt.receipt_id != receipt_id
        or transaction.receipt.step_id != step_id
        or transaction.receipt.action_name != action_name
    ):
        raise RuntimeError("Guided Edit Poke transaction binding changed")
    stage = completed_operations[-1] if completed_operations else 0
    _validate_stage(
        receipts,
        transaction.receipt,
        definition,
        completed_operations,
        deps,
    )
    if (
        _fingerprint(receipts, transaction.receipt, definition, stage, deps)
        != transaction.fingerprint
    ):
        raise RuntimeError("Guided Edit Poke transaction fingerprint changed")


def verify_edit_poke_stage(
    *,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    completed_operations: tuple[int, ...],
    expected_fingerprint: str,
    partial_receipt: Any | None,
    rebind_after_native_restore: bool = False,
) -> bool:
    if completed_operations != tuple(range(1, len(completed_operations) + 1)):
        raise ValueError("completed_operations must be an ordinal prefix")
    deps = _dependencies()
    rebound_receipts = receipts
    rebound_partial = partial_receipt
    if rebind_after_native_restore:
        rebound_receipts = deps.rebind_receipts_after_native_restore(receipts)
        if partial_receipt is not None:
            rebound_partial = deps.rebind_receipts_after_native_restore(
                {"guided-partial": partial_receipt}
            )["guided-partial"]
    receipt_required = any(
        ordinal in EDIT_POKE_MUTATING_ORDINALS
        for ordinal in completed_operations
    )
    if receipt_required:
        if rebound_partial is None:
            raise RuntimeError("Edit Poke partial receipt is unavailable")
        transaction = GuidedGeometryTransaction(
            rebound_partial,
            completed_operations,
            expected_fingerprint,
            _definition_fingerprint(definition),
        )
        _validate_transaction(
            transaction,
            receipt_id,
            step_id,
            action_name,
            completed_operations,
            rebound_receipts,
            definition,
            deps,
        )
    else:
        if rebound_partial is not None:
            raise RuntimeError("Edit Poke pre-mutation stage contains a receipt")
        target_identity = _source_resources(
            rebound_receipts, definition, deps
        )[0]
        receipt = _empty_receipt(
            receipt_id,
            step_id,
            action_name,
            target_identity,
            deps,
        )
        _validate_stage(
            rebound_receipts,
            receipt,
            definition,
            completed_operations,
            deps,
        )
        stage = completed_operations[-1] if completed_operations else 0
        if (
            _fingerprint(rebound_receipts, receipt, definition, stage, deps)
            != expected_fingerprint
        ):
            raise RuntimeError("Edit Poke stage fingerprint changed")
    return True


def execute_edit_poke_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction | None = None,
) -> GuidedGeometryOperationResult:
    if action_name != EDIT_POKE_ACTION:
        raise ValueError(f"Unsupported guided Edit Poke action: {action_name}")
    if not 1 <= operation_ordinal <= len(EDIT_POKE_OPERATION_IDS):
        raise ValueError("operation_ordinal must be in [1, 6]")
    deps = _dependencies()
    expected_completed = tuple(range(1, operation_ordinal))
    if transaction is None:
        if operation_ordinal != 1:
            raise RuntimeError("Guided Edit Poke operation 01 must start the transaction")
        target_identity = _source_resources(receipts, definition, deps)[0]
        receipt = _empty_receipt(
            receipt_id, step_id, action_name, target_identity, deps
        )
        before = _fingerprint(receipts, receipt, definition, 0, deps)
    else:
        _validate_transaction(
            transaction,
            receipt_id,
            step_id,
            action_name,
            expected_completed,
            receipts,
            definition,
            deps,
        )
        receipt = transaction.receipt
        before = transaction.fingerprint

    edit_poke_mesh_operations: tuple[dict[str, Any], ...] = ()
    try:
        if operation_ordinal == 1:
            _validate_base_state(receipts, definition, receipt_id, deps)
        elif operation_ordinal == 5:
            receipt, edit_poke_mesh_operations = _create_poke_mesh(
                receipt, receipts, definition, deps
            )
        elif operation_ordinal == 6:
            receipt, edit_poke_mesh_operations = _apply_managed_contract(
                receipt, receipts, definition, deps
            )
        else:
            _validate_stage(
                receipts, receipt, definition, expected_completed, deps
            )
        completed = (*expected_completed, operation_ordinal)
        _validate_stage(receipts, receipt, definition, completed, deps)
    except GuidedGeometryAtomicityError:
        raise
    except Exception as error:
        try:
            if operation_ordinal == 5 and receipt.created:
                receipt = _remove_result_mesh(receipt, definition, deps)
            elif operation_ordinal == 6:
                _validate_stage(
                    receipts, receipt, definition, expected_completed, deps
                )
            _validate_stage(
                receipts, receipt, definition, expected_completed, deps
            )
            prior_stage = expected_completed[-1] if expected_completed else 0
            if (
                _fingerprint(
                    receipts, receipt, definition, prior_stage, deps
                )
                != before
            ):
                raise RuntimeError("Edit Poke compensation fingerprint changed")
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                "Guided Edit Poke forward operation "
                f"{operation_ordinal:02d} failed and rollback failed"
            ) from recovery_error
        raise error

    stage = completed[-1]
    after = _fingerprint(receipts, receipt, definition, stage, deps)
    result_transaction = GuidedGeometryTransaction(
        receipt,
        completed,
        after,
        _definition_fingerprint(definition),
    )
    return GuidedGeometryOperationResult(
        result_transaction,
        _observation(
            ordinal=operation_ordinal,
            direction="forward",
            receipt=receipt,
            before=before,
            after=after,
            definition=definition,
            completed=completed,
            edit_poke_mesh_operations=edit_poke_mesh_operations,
        ),
        before,
        after,
    )


def inverse_edit_poke_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction,
) -> GuidedGeometryOperationResult:
    if action_name != EDIT_POKE_ACTION:
        raise ValueError(f"Unsupported guided Edit Poke action: {action_name}")
    if (
        not transaction.completed_operations
        or transaction.completed_operations[-1] != operation_ordinal
    ):
        raise RuntimeError("Guided Edit Poke inverse must target the latest operation")
    deps = _dependencies()
    _validate_transaction(
        transaction,
        receipt_id,
        step_id,
        action_name,
        transaction.completed_operations,
        receipts,
        definition,
        deps,
    )
    receipt = transaction.receipt
    before = transaction.fingerprint
    if operation_ordinal == 6:
        receipt = _reset_managed_contract(receipt, receipts, definition, deps)
    elif operation_ordinal == 5:
        receipt = _remove_result_mesh(receipt, definition, deps)
    completed = transaction.completed_operations[:-1]
    _validate_stage(receipts, receipt, definition, completed, deps)
    stage = completed[-1] if completed else 0
    after = _fingerprint(receipts, receipt, definition, stage, deps)
    result_transaction = GuidedGeometryTransaction(
        receipt,
        completed,
        after,
        transaction.definition_fingerprint,
    )
    return GuidedGeometryOperationResult(
        result_transaction,
        _observation(
            ordinal=operation_ordinal,
            direction="inverse",
            receipt=receipt,
            before=before,
            after=after,
            definition=definition,
            completed=completed,
        ),
        before,
        after,
    )


__all__ = (
    "EDIT_POKE_ACTION",
    "EDIT_POKE_MUTATING_ORDINALS",
    "EDIT_POKE_OPERATION_IDS",
    "execute_edit_poke_operation",
    "inverse_edit_poke_operation",
    "resume_edit_poke_transaction",
    "verify_edit_poke_stage",
)
