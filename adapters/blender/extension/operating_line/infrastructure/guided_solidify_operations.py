"""Operation-level execution for the bounded Solidify Modifier guide leaf."""

from __future__ import annotations

from dataclasses import replace
import hashlib
import math
from types import SimpleNamespace
from typing import Any, Mapping

from .guided_geometry_operations import (
    GuidedGeometryAtomicityError,
    GuidedGeometryOperationResult,
    GuidedGeometryTransaction,
)


SOLIDIFY_ACTION = "blender.modifier.add_solidify"
SOLIDIFY_OPERATION_IDS = (
    "workspace.layout",
    "panel.modifier_properties",
    "control.add_modifier",
    "semantic.solidify_parameters",
)
SOLIDIFY_MUTATING_ORDINALS = frozenset({3, 4})
_SOLIDIFY_EXECUTE_TOOL = "operatingline.blender.modifier.solidify.execute-next"

_SOLIDIFY_PROPERTY_SPECS = (
    ("solidify_mode", "EXTRUDE", "catalog_constant", None),
    ("thickness", None, "accepted_action_argument", "thickness"),
    ("thickness_clamp", 0.0, "catalog_constant", None),
    ("use_thickness_angle_clamp", False, "catalog_constant", None),
    ("thickness_vertex_group", 0.0, "catalog_constant", None),
    ("offset", None, "accepted_action_argument", "offset"),
    ("edge_crease_inner", 0.0, "catalog_constant", None),
    ("edge_crease_outer", 0.0, "catalog_constant", None),
    ("edge_crease_rim", 0.0, "catalog_constant", None),
    ("material_offset", 0, "catalog_constant", None),
    ("material_offset_rim", 0, "catalog_constant", None),
    ("vertex_group", "", "catalog_constant", None),
    ("shell_vertex_group", "", "catalog_constant", None),
    ("rim_vertex_group", "", "catalog_constant", None),
    ("use_even_offset", True, "catalog_constant", None),
    ("use_rim", True, "catalog_constant", None),
    ("use_rim_only", False, "catalog_constant", None),
    ("use_quality_normals", False, "catalog_constant", None),
    ("invert_vertex_group", False, "catalog_constant", None),
    ("use_flat_faces", False, "catalog_constant", None),
    ("use_flip_normals", False, "catalog_constant", None),
    ("nonmanifold_thickness_mode", "CONSTRAINTS", "catalog_constant", None),
    ("nonmanifold_boundary_mode", "NONE", "catalog_constant", None),
    ("nonmanifold_merge_threshold", 0.0001, "catalog_constant", None),
    ("bevel_convex", 0.0, "catalog_constant", None),
)


def _dependencies() -> SimpleNamespace:
    from ..application.session import ModifierState, MutationRecord
    from .snowman_actions.common import (
        build_resource_registry,
        ensure_modifier_id_available,
        ensure_receipts_intact,
        find_owned_modifier,
        make_receipt,
        mesh_content_signature,
        owned_resource,
        rebind_receipts_after_native_restore,
        resolve_resource,
        rollback_partial,
        rollback_receipt,
        snapshot_modifier,
    )
    from .snowman_actions.editing import _ensure_solidify_input_is_bounded

    return SimpleNamespace(
        ModifierState=ModifierState,
        MutationRecord=MutationRecord,
        build_resource_registry=build_resource_registry,
        ensure_modifier_id_available=ensure_modifier_id_available,
        ensure_receipts_intact=ensure_receipts_intact,
        ensure_solidify_input_is_bounded=_ensure_solidify_input_is_bounded,
        find_owned_modifier=find_owned_modifier,
        make_receipt=make_receipt,
        mesh_content_signature=mesh_content_signature,
        owned_resource=owned_resource,
        rebind_receipts_after_native_restore=rebind_receipts_after_native_restore,
        resolve_resource=resolve_resource,
        rollback_partial=rollback_partial,
        rollback_receipt=rollback_receipt,
        snapshot_modifier=snapshot_modifier,
    )


def _bpy() -> Any:
    import bpy

    return bpy


def _digest(value: Any) -> str:
    return hashlib.sha256(repr(value).encode("utf-8")).hexdigest()


def _definition_fingerprint(definition: Any) -> str:
    return _digest(
        (
            definition.target_id,
            definition.modifier_id,
            definition.modifier_name,
            float(definition.thickness),
            float(definition.offset),
        )
    )


def _pending_modifier_name(receipt_id: str) -> str:
    return f"OperatingLine.PendingSolidifyModifier.{receipt_id[:8]}"


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


def _owned_resources(
    receipts: Mapping[str, Any], definition: Any, deps: Any
) -> tuple[Any, Any, Any, Any]:
    registry = deps.build_resource_registry(receipts)
    target_identity, target = deps.owned_resource(
        registry, definition.target_id, "OBJECT"
    )
    if getattr(target, "type", None) != "MESH":
        raise ValueError(
            f"Solidify target is not an owned mesh: {definition.target_id}"
        )
    mesh_identity = next(
        (
            identity
            for identity in registry.values()
            if identity.resource_type == "MESH"
            and deps.resolve_resource(identity) is target.data
        ),
        None,
    )
    if mesh_identity is None:
        raise RuntimeError(
            f"Owned Solidify mesh data is unavailable: {definition.target_id}"
        )
    return target_identity, target, mesh_identity, target.data


def _ensure_modifier_name_available(target: Any, name: str) -> None:
    if target.modifiers.get(name) is not None:
        raise RuntimeError(f"Cannot replace existing modifier: {name}")


def _validate_base_state(
    receipts: Mapping[str, Any], definition: Any, receipt_id: str, deps: Any
) -> tuple[Any, Any, Any, Any]:
    deps.ensure_receipts_intact(receipts)
    resources = _owned_resources(receipts, definition, deps)
    _target_identity, target, _mesh_identity, _mesh = resources
    deps.ensure_solidify_input_is_bounded(receipts, target)
    deps.ensure_modifier_id_available(receipts, definition.modifier_id)
    _ensure_modifier_name_available(target, definition.modifier_name)
    _ensure_modifier_name_available(target, _pending_modifier_name(receipt_id))
    return resources


def _accepted_property_value(definition: Any, property_name: str, value: Any) -> Any:
    if property_name == "thickness":
        return float(definition.thickness)
    if property_name == "offset":
        return float(definition.offset)
    return value


def _solidify_property_values(modifier: Any) -> tuple[tuple[str, Any], ...]:
    return tuple(
        (property_name, getattr(modifier, property_name))
        for property_name, _value, _source, _argument in _SOLIDIFY_PROPERTY_SPECS
    )


def _same_value(actual: Any, expected: Any) -> bool:
    if isinstance(expected, float):
        return (
            isinstance(actual, (int, float))
            and not isinstance(actual, bool)
            and math.isclose(
                float(actual),
                expected,
                rel_tol=1e-6,
                abs_tol=1e-6,
            )
        )
    return actual == expected


def _solidify_matches_definition(modifier: Any, definition: Any) -> bool:
    return bool(
        modifier.type == "SOLIDIFY"
        and modifier.name == definition.modifier_name
        and all(
            _same_value(
                getattr(modifier, property_name),
                _accepted_property_value(definition, property_name, value),
            )
            for property_name, value, _source, _argument in _SOLIDIFY_PROPERTY_SPECS
        )
    )


def _modifier_signature(target: Any) -> tuple[Any, ...]:
    return tuple(
        (
            modifier.name,
            modifier.type,
            int(modifier.as_pointer()),
            _solidify_property_values(modifier)
            if modifier.type == "SOLIDIFY"
            else None,
        )
        for modifier in target.modifiers
    )


def _fingerprint(receipts: Mapping[str, Any], definition: Any, deps: Any) -> str:
    _bpy().context.view_layer.update()
    _target_identity, target, _mesh_identity, mesh = _owned_resources(
        receipts, definition, deps
    )
    return _digest(
        (
            (target.name, target.type, mesh.name),
            deps.mesh_content_signature(mesh),
            _modifier_signature(target),
        )
    )


def _modifier_mutation(receipt: Any, definition: Any, deps: Any) -> Any:
    matches = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.attribute == f"modifier:{definition.modifier_id}"
        and isinstance(mutation.after, deps.ModifierState)
    )
    if len(matches) != 1:
        raise RuntimeError("Partial Solidify receipt must contain one modifier state")
    return matches[0]


def _modifier_from_mutation(
    receipt: Any, definition: Any, deps: Any
) -> tuple[Any, Any, Any]:
    mutation = _modifier_mutation(receipt, definition, deps)
    target = deps.resolve_resource(mutation.resource)
    state = mutation.after
    if target is None or not 0 <= state.stack_index < len(target.modifiers):
        raise RuntimeError("Partial Solidify modifier is unavailable")
    modifier = target.modifiers[state.stack_index]
    if modifier.as_pointer() != state.pointer or modifier.type != "SOLIDIFY":
        raise RuntimeError("Partial Solidify modifier binding changed")
    return mutation, target, modifier


def _validate_stage(
    receipts: Mapping[str, Any],
    receipt: Any,
    definition: Any,
    completed_operations: tuple[int, ...],
    deps: Any,
) -> tuple[Any, Any]:
    stage = completed_operations[-1] if completed_operations else 0
    target_identity, target, mesh_identity, mesh = _owned_resources(
        receipts, definition, deps
    )
    if receipt.anchor != target_identity or receipt.created or receipt.artifacts:
        raise RuntimeError("Partial Solidify receipt binding changed")
    if stage < 3:
        _validate_base_state(receipts, definition, receipt.receipt_id, deps)
        if receipt.mutations:
            raise RuntimeError("Solidify pre-mutation receipt changed")
        return target, mesh

    combined_receipts = dict(receipts)
    combined_receipts["__guided_solidify_partial__"] = receipt
    deps.ensure_receipts_intact(combined_receipts)
    deps.ensure_solidify_input_is_bounded(combined_receipts, target)
    if len(receipt.mutations) != 3:
        raise RuntimeError("Partial Solidify receipt mutation set changed")
    mutation = _modifier_mutation(receipt, definition, deps)
    owned = deps.find_owned_modifier(
        {"guided-partial": receipt}, definition.modifier_id
    )
    data_guard = next(
        (item for item in receipt.mutations if item.attribute == "data"), None
    )
    mesh_guard = next(
        (item for item in receipt.mutations if item.attribute == "mesh_content"),
        None,
    )
    expected_name = (
        _pending_modifier_name(receipt.receipt_id)
        if stage == 3
        else definition.modifier_name
    )
    modifier = owned[1] if owned is not None else None
    checks = {
        "owner": owned is not None and owned[0] is target,
        "resource": mutation.resource == target_identity,
        "created": mutation.before is None,
        "name": modifier is not None and modifier.name == expected_name,
        "state_name": mutation.after.display_name == expected_name,
        "type": modifier is not None and modifier.type == "SOLIDIFY",
        "data_guard": data_guard is not None
        and data_guard.resource == target_identity
        and data_guard.before == mesh_identity
        and data_guard.after == mesh_identity
        and target.data is mesh,
        "mesh_guard": mesh_guard is not None
        and mesh_guard.resource == mesh_identity
        and mesh_guard.before == mesh_guard.after
        and mesh_guard.after == deps.mesh_content_signature(mesh),
        "settings": stage == 3
        or (modifier is not None and _solidify_matches_definition(modifier, definition)),
    }
    failed = tuple(name for name, passed in checks.items() if not passed)
    if failed:
        raise RuntimeError(
            "Partial Solidify modifier state changed: " + ", ".join(failed)
        )
    return target, mesh


def _create_modifier_for_receipt(
    receipt: Any,
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    target_identity, target, mesh_identity, mesh = _validate_base_state(
        receipts, definition, receipt.receipt_id, deps
    )
    pending_name = _pending_modifier_name(receipt.receipt_id)
    modifier = None
    mutations: list[Any] = []
    try:
        modifier = target.modifiers.new(pending_name, "SOLIDIFY")
        state = deps.snapshot_modifier(
            target,
            modifier,
            definition.modifier_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            {},
        )
        mutations.extend(
            (
                deps.MutationRecord(
                    target_identity,
                    f"modifier:{definition.modifier_id}",
                    None,
                    state,
                ),
                deps.MutationRecord(
                    target_identity,
                    "data",
                    mesh_identity,
                    mesh_identity,
                ),
                deps.MutationRecord(
                    mesh_identity,
                    "mesh_content",
                    deps.mesh_content_signature(mesh),
                    deps.mesh_content_signature(mesh),
                ),
            )
        )
        if (
            modifier.bl_rna.identifier != "SolidifyModifier"
            or modifier.name != pending_name
            or modifier.type != "SOLIDIFY"
        ):
            raise RuntimeError("Solidify Modifier RNA creation readback changed")
        evidence = (
            {
                "order": 1,
                "executionMethod": "blender_rna_solidify_modifier_create",
                "mcpTool": _SOLIDIFY_EXECUTE_TOOL,
                "sourceOperationId": SOLIDIFY_OPERATION_IDS[2],
                "semanticAction": SOLIDIFY_OPERATION_IDS[2],
                "valueSource": "managed_receipt_identity",
                "mutationKind": "solidify_modifier_create",
                "targetId": definition.target_id,
                "modifierId": definition.modifier_id,
                "pendingModifierName": pending_name,
                "resourceType": modifier.bl_rna.identifier,
                "modifierType": modifier.type,
                "observedResource": True,
                "uiPath": [
                    "Properties",
                    definition.target_id,
                    "Modifiers",
                    "Add Modifier",
                    "Generate",
                    "Solidify",
                    pending_name,
                ],
            },
        )
        return replace(receipt, mutations=tuple(mutations)), evidence
    except Exception:
        if mutations:
            deps.rollback_partial(
                receipt.receipt_id,
                receipt.step_id,
                receipt.action_name,
                [],
                mutations,
                [],
            )
        elif modifier is not None:
            target.modifiers.remove(modifier)
        raise


def _replace_modifier_state(
    receipt: Any, mutation: Any, target: Any, modifier: Any, definition: Any, deps: Any
) -> Any:
    state = deps.snapshot_modifier(
        target,
        modifier,
        definition.modifier_id,
        receipt.receipt_id,
        receipt.step_id,
        receipt.action_name,
        {},
    )
    updated = replace(mutation, after=state)
    return replace(
        receipt,
        mutations=tuple(updated if item is mutation else item for item in receipt.mutations),
    )


def _restore_modifier_values(
    modifier: Any, name: str, values: tuple[tuple[str, Any], ...]
) -> None:
    modifier.name = name
    for property_name, value in values:
        setattr(modifier, property_name, value)


def _configure_modifier(
    receipt: Any, definition: Any, deps: Any
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    mutation, target, modifier = _modifier_from_mutation(receipt, definition, deps)
    before_name = modifier.name
    before_values = _solidify_property_values(modifier)
    try:
        modifier.name = definition.modifier_name
        evidence: list[dict[str, Any]] = [
            {
                "order": 1,
                "executionMethod": "blender_rna_modifier_name_write",
                "mcpTool": _SOLIDIFY_EXECUTE_TOOL,
                "sourceOperationId": SOLIDIFY_OPERATION_IDS[3],
                "semanticAction": SOLIDIFY_OPERATION_IDS[3],
                "valueSource": "accepted_action_argument",
                "actionArgument": "modifierName",
                "mutationKind": "solidify_modifier_name_write",
                "targetId": definition.target_id,
                "modifierId": definition.modifier_id,
                "beforeName": before_name,
                "acceptedName": definition.modifier_name,
                "observedName": modifier.name,
                "uiPath": [
                    "Properties",
                    definition.target_id,
                    "Modifiers",
                    modifier.name,
                    "Name",
                ],
            }
        ]
        for property_name, value, value_source, action_argument in (
            _SOLIDIFY_PROPERTY_SPECS
        ):
            accepted_value = _accepted_property_value(
                definition, property_name, value
            )
            setattr(modifier, property_name, accepted_value)
            observed_value = getattr(modifier, property_name)
            if not _same_value(observed_value, accepted_value):
                raise RuntimeError(
                    f"Solidify Modifier RNA readback changed: {property_name}"
                )
            evidence.append(
                {
                    "order": len(evidence) + 1,
                    "executionMethod": "blender_rna_solidify_modifier_property_write",
                    "mcpTool": _SOLIDIFY_EXECUTE_TOOL,
                    "sourceOperationId": SOLIDIFY_OPERATION_IDS[3],
                    "semanticAction": SOLIDIFY_OPERATION_IDS[3],
                    "valueSource": value_source,
                    "actionArgument": action_argument,
                    "mutationKind": "solidify_modifier_property_write",
                    "targetId": definition.target_id,
                    "modifierId": definition.modifier_id,
                    "modifierName": definition.modifier_name,
                    "propertyName": property_name,
                    "acceptedValue": accepted_value,
                    "observedValue": observed_value,
                    "uiPath": [
                        "Properties",
                        definition.target_id,
                        "Modifiers",
                        definition.modifier_name,
                        property_name,
                    ],
                }
            )
        if not _solidify_matches_definition(modifier, definition):
            raise RuntimeError("Solidify Modifier fixed RNA contract changed")
        return (
            _replace_modifier_state(
                receipt, mutation, target, modifier, definition, deps
            ),
            tuple(evidence),
        )
    except Exception:
        _restore_modifier_values(modifier, before_name, before_values)
        if modifier.name != before_name or _solidify_property_values(modifier) != before_values:
            raise GuidedGeometryAtomicityError(
                "Solidify configuration failed and its prior state was not restored"
            )
        raise


def _default_modifier_values(target: Any, receipt_id: str) -> tuple[tuple[str, Any], ...]:
    probe_name = f"OperatingLine.SolidifyDefaultsProbe.{receipt_id[:8]}"
    _ensure_modifier_name_available(target, probe_name)
    probe = target.modifiers.new(probe_name, "SOLIDIFY")
    try:
        return _solidify_property_values(probe)
    finally:
        target.modifiers.remove(probe)


def _reset_modifier(receipt: Any, definition: Any, deps: Any) -> Any:
    mutation, target, modifier = _modifier_from_mutation(receipt, definition, deps)
    before_name = modifier.name
    before_values = _solidify_property_values(modifier)
    default_values = _default_modifier_values(target, receipt.receipt_id)
    pending_name = _pending_modifier_name(receipt.receipt_id)
    try:
        _restore_modifier_values(modifier, pending_name, default_values)
        return _replace_modifier_state(
            receipt, mutation, target, modifier, definition, deps
        )
    except Exception:
        _restore_modifier_values(modifier, before_name, before_values)
        if modifier.name != before_name or _solidify_property_values(modifier) != before_values:
            raise GuidedGeometryAtomicityError(
                "Solidify inverse failed and the configured state was not restored"
            )
        raise


def _remove_modifier(receipt: Any, definition: Any, deps: Any) -> Any:
    _modifier_mutation(receipt, definition, deps)
    target_identity = receipt.anchor
    mini_receipt = deps.make_receipt(
        receipt.receipt_id,
        receipt.step_id,
        receipt.action_name,
        [],
        list(receipt.mutations),
        [],
        target_identity,
    )
    deps.rollback_receipt(mini_receipt)
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
    rna_mutations: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    stage = completed[-1] if completed else 0
    return {
        "kind": "guided_modifier_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": direction,
            "operationOrdinal": ordinal,
            "operationId": SOLIDIFY_OPERATION_IDS[ordinal - 1],
            "mutating": ordinal in SOLIDIFY_MUTATING_ORDINALS,
            "receiptId": receipt.receipt_id,
            "stepId": receipt.step_id,
            "actionName": receipt.action_name,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(completed),
                "preconditionsValidated": ordinal == 1,
                "completeSolidify": ordinal == len(SOLIDIFY_OPERATION_IDS),
                "stage": min(stage, len(SOLIDIFY_OPERATION_IDS)),
                "targetId": definition.target_id,
                "modifierId": definition.modifier_id,
                "modifierCreated": stage >= 3,
                "settingsApplied": stage >= 4,
                "resolvedModifierName": (
                    definition.modifier_name if stage >= 4 else None
                ),
                "rnaSolidifyModifierMutations": list(rna_mutations),
            },
        },
    }


def resume_solidify_transaction(
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
            "A resumed Solidify transaction requires its receipt and fingerprint"
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
) -> tuple[Any, Any]:
    if (
        transaction.completed_operations != completed_operations
        or transaction.definition_fingerprint != _definition_fingerprint(definition)
        or transaction.receipt.receipt_id != receipt_id
        or transaction.receipt.step_id != step_id
        or transaction.receipt.action_name != action_name
    ):
        raise RuntimeError("Guided Solidify transaction binding changed")
    resources = _validate_stage(
        receipts,
        transaction.receipt,
        definition,
        completed_operations,
        deps,
    )
    if _fingerprint(receipts, definition, deps) != transaction.fingerprint:
        raise RuntimeError("Guided Solidify transaction fingerprint changed")
    return resources


def verify_solidify_stage(
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
        ordinal in SOLIDIFY_MUTATING_ORDINALS for ordinal in completed_operations
    )
    if receipt_required:
        if rebound_partial is None:
            raise RuntimeError("Solidify partial receipt is unavailable")
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
            raise RuntimeError("Solidify pre-mutation stage contains a receipt")
        target_identity = _owned_resources(rebound_receipts, definition, deps)[0]
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
        if _fingerprint(rebound_receipts, definition, deps) != expected_fingerprint:
            raise RuntimeError("Solidify stage fingerprint changed")
    return True


def execute_solidify_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction | None = None,
) -> GuidedGeometryOperationResult:
    if action_name != SOLIDIFY_ACTION:
        raise ValueError(f"Unsupported guided Solidify action: {action_name}")
    if not 1 <= operation_ordinal <= len(SOLIDIFY_OPERATION_IDS):
        raise ValueError("operation_ordinal must be in [1, 4]")
    deps = _dependencies()
    expected_completed = tuple(range(1, operation_ordinal))
    if transaction is None:
        if operation_ordinal != 1:
            raise RuntimeError("Guided Solidify operation 01 must start the transaction")
        target_identity = _owned_resources(receipts, definition, deps)[0]
        receipt = _empty_receipt(
            receipt_id, step_id, action_name, target_identity, deps
        )
        before = _fingerprint(receipts, definition, deps)
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

    rna_mutations: tuple[dict[str, Any], ...] = ()
    try:
        if operation_ordinal == 1:
            _validate_base_state(receipts, definition, receipt_id, deps)
        elif operation_ordinal == 3:
            receipt, rna_mutations = _create_modifier_for_receipt(
                receipt, receipts, definition, deps
            )
        elif operation_ordinal == 4:
            receipt, rna_mutations = _configure_modifier(
                receipt, definition, deps
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
            if operation_ordinal == 3 and receipt.mutations:
                receipt = _remove_modifier(receipt, definition, deps)
            elif operation_ordinal == 4:
                _validate_stage(
                    receipts, receipt, definition, expected_completed, deps
                )
            if _fingerprint(receipts, definition, deps) != before:
                raise RuntimeError("Solidify compensation fingerprint changed")
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                "Guided Solidify forward operation "
                f"{operation_ordinal:02d} failed and rollback failed"
            ) from recovery_error
        raise error

    after = _fingerprint(receipts, definition, deps)
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
            rna_mutations=rna_mutations,
        ),
        before,
        after,
    )


def inverse_solidify_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction,
) -> GuidedGeometryOperationResult:
    if action_name != SOLIDIFY_ACTION:
        raise ValueError(f"Unsupported guided Solidify action: {action_name}")
    if (
        not transaction.completed_operations
        or transaction.completed_operations[-1] != operation_ordinal
    ):
        raise RuntimeError("Guided Solidify inverse must target the latest operation")
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
    if operation_ordinal == 4:
        receipt = _reset_modifier(receipt, definition, deps)
    elif operation_ordinal == 3:
        receipt = _remove_modifier(receipt, definition, deps)
    completed = transaction.completed_operations[:-1]
    _validate_stage(receipts, receipt, definition, completed, deps)
    after = _fingerprint(receipts, definition, deps)
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
    "SOLIDIFY_ACTION",
    "SOLIDIFY_MUTATING_ORDINALS",
    "SOLIDIFY_OPERATION_IDS",
    "execute_solidify_operation",
    "inverse_solidify_operation",
    "resume_solidify_transaction",
    "verify_solidify_stage",
)
