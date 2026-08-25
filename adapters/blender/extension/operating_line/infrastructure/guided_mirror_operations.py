"""Operation-level execution for the bounded Mirror Modifier guide leaf."""

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


MIRROR_ACTION = "blender.modifier.add_mirror"
MIRROR_OPERATION_IDS = (
    "workspace.layout",
    "semantic.select_owned_mesh",
    "panel.modifier_properties",
    "control.add_modifier",
    "category.generate",
    "modifier.mirror",
    "semantic.mirror_contract",
)
MIRROR_MUTATING_ORDINALS = frozenset({6, 7})
_MIRROR_EXECUTE_TOOL = "operatingline.blender.modifier.mirror.execute-next"

_MIRROR_PROPERTY_SPECS = (
    ("use_axis", 0, None, "accepted_action_argument", "axis"),
    ("use_axis", 1, None, "accepted_action_argument", "axis"),
    ("use_axis", 2, None, "accepted_action_argument", "axis"),
    ("use_bisect_axis", 0, False, "catalog_constant", None),
    ("use_bisect_axis", 1, False, "catalog_constant", None),
    ("use_bisect_axis", 2, False, "catalog_constant", None),
    ("use_bisect_flip_axis", 0, False, "catalog_constant", None),
    ("use_bisect_flip_axis", 1, False, "catalog_constant", None),
    ("use_bisect_flip_axis", 2, False, "catalog_constant", None),
    ("use_clip", None, False, "catalog_constant", None),
    ("use_mirror_merge", None, True, "catalog_constant", None),
    ("merge_threshold", None, 0.001, "catalog_constant", None),
    ("bisect_threshold", None, 0.001, "catalog_constant", None),
    ("mirror_object", None, None, "catalog_constant", None),
    ("use_mirror_vertex_groups", None, True, "catalog_constant", None),
    ("use_mirror_u", None, False, "catalog_constant", None),
    ("use_mirror_v", None, False, "catalog_constant", None),
    ("use_mirror_udim", None, False, "catalog_constant", None),
    ("offset_u", None, 0.0, "catalog_constant", None),
    ("offset_v", None, 0.0, "catalog_constant", None),
    ("mirror_offset_u", None, 0.0, "catalog_constant", None),
    ("mirror_offset_v", None, 0.0, "catalog_constant", None),
    ("show_viewport", None, True, "catalog_constant", None),
    ("show_render", None, True, "catalog_constant", None),
    ("show_in_editmode", None, True, "catalog_constant", None),
    ("show_on_cage", None, False, "catalog_constant", None),
    ("use_apply_on_spline", None, False, "catalog_constant", None),
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
    from .snowman_actions.editing import (
        _ensure_mirror_evaluated_output_is_bounded,
        _ensure_mirror_input_is_bounded,
    )

    return SimpleNamespace(
        ModifierState=ModifierState,
        MutationRecord=MutationRecord,
        build_resource_registry=build_resource_registry,
        ensure_modifier_id_available=ensure_modifier_id_available,
        ensure_receipts_intact=ensure_receipts_intact,
        ensure_mirror_evaluated_output_is_bounded=(
            _ensure_mirror_evaluated_output_is_bounded
        ),
        ensure_mirror_input_is_bounded=_ensure_mirror_input_is_bounded,
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
            definition.axis,
        )
    )


def _pending_modifier_name(receipt_id: str) -> str:
    return f"OperatingLine.PendingMirrorModifier.{receipt_id[:8]}"


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
            f"Mirror target is not an owned mesh: {definition.target_id}"
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
            f"Owned Mirror mesh data is unavailable: {definition.target_id}"
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
    deps.ensure_mirror_input_is_bounded(receipts, target)
    deps.ensure_modifier_id_available(receipts, definition.modifier_id)
    _ensure_modifier_name_available(target, definition.modifier_name)
    _ensure_modifier_name_available(target, _pending_modifier_name(receipt_id))
    return resources


def _accepted_property_value(
    definition: Any,
    property_name: str,
    component_index: int | None,
    value: Any,
) -> Any:
    if property_name == "use_axis":
        return component_index == {"X": 0, "Y": 1, "Z": 2}[definition.axis]
    return value


def _read_property_value(
    modifier: Any, property_name: str, component_index: int | None
) -> Any:
    value = getattr(modifier, property_name)
    return value if component_index is None else value[component_index]


def _write_property_value(
    modifier: Any,
    property_name: str,
    component_index: int | None,
    value: Any,
) -> None:
    if component_index is None:
        setattr(modifier, property_name, value)
        return
    components = list(getattr(modifier, property_name))
    components[component_index] = value
    setattr(modifier, property_name, tuple(components))


def _mirror_property_values(
    modifier: Any,
) -> tuple[tuple[str, int | None, Any], ...]:
    return tuple(
        (
            property_name,
            component_index,
            _read_property_value(modifier, property_name, component_index),
        )
        for (
            property_name,
            component_index,
            _value,
            _source,
            _argument,
        ) in _MIRROR_PROPERTY_SPECS
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


def _mirror_matches_definition(modifier: Any, definition: Any) -> bool:
    return bool(
        modifier.type == "MIRROR"
        and modifier.name == definition.modifier_name
        and all(
            _same_value(
                _read_property_value(modifier, property_name, component_index),
                _accepted_property_value(
                    definition,
                    property_name,
                    component_index,
                    value,
                ),
            )
            for (
                property_name,
                component_index,
                value,
                _source,
                _argument,
            ) in _MIRROR_PROPERTY_SPECS
        )
    )


def _modifier_signature(target: Any) -> tuple[Any, ...]:
    return tuple(
        (
            modifier.name,
            modifier.type,
            int(modifier.as_pointer()),
            _mirror_property_values(modifier)
            if modifier.type == "MIRROR"
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
        raise RuntimeError("Partial Mirror receipt must contain one modifier state")
    return matches[0]


def _modifier_from_mutation(
    receipt: Any, definition: Any, deps: Any
) -> tuple[Any, Any, Any]:
    mutation = _modifier_mutation(receipt, definition, deps)
    target = deps.resolve_resource(mutation.resource)
    state = mutation.after
    if target is None or not 0 <= state.stack_index < len(target.modifiers):
        raise RuntimeError("Partial Mirror modifier is unavailable")
    modifier = target.modifiers[state.stack_index]
    if modifier.as_pointer() != state.pointer or modifier.type != "MIRROR":
        raise RuntimeError("Partial Mirror modifier binding changed")
    return mutation, target, modifier


def _projected_topology_without_modifier(
    target: Any, modifier: Any
) -> tuple[int, int, int]:
    if target.mode != "OBJECT":
        raise RuntimeError("Mirror target must be in Object Mode")
    if target.data.shape_keys is not None:
        raise RuntimeError("Mirror target must not have shape keys")
    limits = (8192, 16384, 8192)

    def validate_mesh(mesh: Any, label: str) -> tuple[int, int, int]:
        topology = (len(mesh.vertices), len(mesh.edges), len(mesh.polygons))
        if not all(topology):
            raise RuntimeError(f"Mirror {label} topology must be nonempty")
        if any(
            not math.isfinite(float(component))
            for vertex in mesh.vertices
            for component in vertex.co
        ):
            raise RuntimeError(f"Mirror {label} vertices must be finite")
        if any(actual > limit for actual, limit in zip(topology, limits)):
            raise RuntimeError(f"Mirror {label} exceeds topology limits")
        return topology

    validate_mesh(target.data, "source")
    visible = bool(modifier.show_viewport)
    try:
        modifier.show_viewport = False
        _bpy().context.view_layer.update()
        evaluated = target.evaluated_get(_bpy().context.evaluated_depsgraph_get())
        evaluated_mesh = evaluated.to_mesh()
        try:
            evaluated_topology = validate_mesh(evaluated_mesh, "evaluated input")
        finally:
            evaluated.to_mesh_clear()
    finally:
        modifier.show_viewport = visible
        _bpy().context.view_layer.update()
    if modifier.show_viewport is not visible:
        raise GuidedGeometryAtomicityError(
            "Mirror topology probe did not restore modifier visibility"
        )
    projected = tuple(value * 2 for value in evaluated_topology)
    if any(actual > limit for actual, limit in zip(projected, limits)):
        raise RuntimeError("Mirror projected output exceeds topology limits")
    return projected


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
        raise RuntimeError("Partial Mirror receipt binding changed")
    if stage < 6:
        _validate_base_state(receipts, definition, receipt.receipt_id, deps)
        if receipt.mutations:
            raise RuntimeError("Mirror pre-mutation receipt changed")
        return target, mesh

    combined_receipts = dict(receipts)
    combined_receipts["__guided_mirror_partial__"] = receipt
    deps.ensure_receipts_intact(combined_receipts)
    if len(receipt.mutations) != 3:
        raise RuntimeError("Partial Mirror receipt mutation set changed")
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
        if stage == 6
        else definition.modifier_name
    )
    modifier = owned[1] if owned is not None else None
    checks = {
        "owner": owned is not None and owned[0] is target,
        "resource": mutation.resource == target_identity,
        "created": mutation.before is None,
        "name": modifier is not None and modifier.name == expected_name,
        "state_name": mutation.after.display_name == expected_name,
        "type": modifier is not None and modifier.type == "MIRROR",
        "data_guard": data_guard is not None
        and data_guard.resource == target_identity
        and data_guard.before == mesh_identity
        and data_guard.after == mesh_identity
        and target.data is mesh,
        "mesh_guard": mesh_guard is not None
        and mesh_guard.resource == mesh_identity
        and mesh_guard.before == mesh_guard.after
        and mesh_guard.after == deps.mesh_content_signature(mesh),
        "settings": stage == 6
        or (modifier is not None and _mirror_matches_definition(modifier, definition)),
    }
    failed = tuple(name for name, passed in checks.items() if not passed)
    if failed:
        raise RuntimeError(
            "Partial Mirror modifier state changed: " + ", ".join(failed)
        )
    projected_topology = _projected_topology_without_modifier(target, modifier)
    deps.ensure_mirror_evaluated_output_is_bounded(target, projected_topology)
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
    projected_topology = deps.ensure_mirror_input_is_bounded(receipts, target)
    pending_name = _pending_modifier_name(receipt.receipt_id)
    modifier = None
    mutations: list[Any] = []
    try:
        modifier = target.modifiers.new(pending_name, "MIRROR")
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
            modifier.bl_rna.identifier != "MirrorModifier"
            or modifier.name != pending_name
            or modifier.type != "MIRROR"
        ):
            raise RuntimeError("Mirror Modifier RNA creation readback changed")
        deps.ensure_mirror_evaluated_output_is_bounded(target, projected_topology)
        evidence = (
            {
                "order": 1,
                "executionMethod": "blender_rna_mirror_modifier_create",
                "mcpTool": _MIRROR_EXECUTE_TOOL,
                "sourceOperationId": MIRROR_OPERATION_IDS[5],
                "semanticAction": MIRROR_OPERATION_IDS[5],
                "valueSource": "managed_receipt_identity",
                "mutationKind": "mirror_modifier_create",
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
                    "Mirror",
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
    modifier: Any,
    name: str,
    values: tuple[tuple[str, int | None, Any], ...],
) -> None:
    modifier.name = name
    for property_name, component_index, value in values:
        _write_property_value(modifier, property_name, component_index, value)


def _configure_modifier(
    receipt: Any, definition: Any, deps: Any
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    mutation, target, modifier = _modifier_from_mutation(receipt, definition, deps)
    before_name = modifier.name
    before_values = _mirror_property_values(modifier)
    try:
        modifier.name = definition.modifier_name
        evidence: list[dict[str, Any]] = [
            {
                "order": 1,
                "executionMethod": "blender_rna_modifier_name_write",
                "mcpTool": _MIRROR_EXECUTE_TOOL,
                "sourceOperationId": MIRROR_OPERATION_IDS[6],
                "semanticAction": MIRROR_OPERATION_IDS[6],
                "valueSource": "accepted_action_argument",
                "actionArgument": "modifierName",
                "mutationKind": "mirror_modifier_name_write",
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
        for (
            property_name,
            component_index,
            value,
            value_source,
            action_argument,
        ) in _MIRROR_PROPERTY_SPECS:
            accepted_value = _accepted_property_value(
                definition,
                property_name,
                component_index,
                value,
            )
            _write_property_value(
                modifier,
                property_name,
                component_index,
                accepted_value,
            )
            observed_value = _read_property_value(
                modifier, property_name, component_index
            )
            if not _same_value(observed_value, accepted_value):
                raise RuntimeError(
                    f"Mirror Modifier RNA readback changed: {property_name}"
                )
            component_label = (
                None if component_index is None else ("X", "Y", "Z")[component_index]
            )
            evidence.append(
                {
                    "order": len(evidence) + 1,
                    "executionMethod": "blender_rna_mirror_modifier_property_write",
                    "mcpTool": _MIRROR_EXECUTE_TOOL,
                    "sourceOperationId": MIRROR_OPERATION_IDS[6],
                    "semanticAction": MIRROR_OPERATION_IDS[6],
                    "valueSource": value_source,
                    "actionArgument": action_argument,
                    "mutationKind": "mirror_modifier_property_write",
                    "targetId": definition.target_id,
                    "modifierId": definition.modifier_id,
                    "modifierName": definition.modifier_name,
                    "propertyName": property_name,
                    **(
                        {
                            "componentIndex": component_index,
                            "componentLabel": component_label,
                        }
                        if component_index is not None
                        else {}
                    ),
                    "acceptedValue": accepted_value,
                    "observedValue": observed_value,
                    "uiPath": [
                        "Properties",
                        definition.target_id,
                        "Modifiers",
                        definition.modifier_name,
                        property_name,
                        *([component_label] if component_label is not None else []),
                    ],
                }
            )
        if not _mirror_matches_definition(modifier, definition):
            raise RuntimeError("Mirror Modifier fixed RNA contract changed")
        deps.ensure_mirror_evaluated_output_is_bounded(
            target,
            _projected_topology_without_modifier(target, modifier),
        )
        return (
            _replace_modifier_state(
                receipt, mutation, target, modifier, definition, deps
            ),
            tuple(evidence),
        )
    except Exception:
        _restore_modifier_values(modifier, before_name, before_values)
        if modifier.name != before_name or _mirror_property_values(modifier) != before_values:
            raise GuidedGeometryAtomicityError(
                "Mirror configuration failed and its prior state was not restored"
            )
        raise


def _default_modifier_values(
    target: Any, receipt_id: str
) -> tuple[tuple[str, int | None, Any], ...]:
    probe_name = f"OperatingLine.MirrorDefaultsProbe.{receipt_id[:8]}"
    _ensure_modifier_name_available(target, probe_name)
    probe = target.modifiers.new(probe_name, "MIRROR")
    try:
        return _mirror_property_values(probe)
    finally:
        target.modifiers.remove(probe)


def _reset_modifier(receipt: Any, definition: Any, deps: Any) -> Any:
    mutation, target, modifier = _modifier_from_mutation(receipt, definition, deps)
    before_name = modifier.name
    before_values = _mirror_property_values(modifier)
    default_values = _default_modifier_values(target, receipt.receipt_id)
    pending_name = _pending_modifier_name(receipt.receipt_id)
    try:
        _restore_modifier_values(modifier, pending_name, default_values)
        return _replace_modifier_state(
            receipt, mutation, target, modifier, definition, deps
        )
    except Exception:
        _restore_modifier_values(modifier, before_name, before_values)
        if modifier.name != before_name or _mirror_property_values(modifier) != before_values:
            raise GuidedGeometryAtomicityError(
                "Mirror inverse failed and the configured state was not restored"
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
            "operationId": MIRROR_OPERATION_IDS[ordinal - 1],
            "mutating": ordinal in MIRROR_MUTATING_ORDINALS,
            "receiptId": receipt.receipt_id,
            "stepId": receipt.step_id,
            "actionName": receipt.action_name,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(completed),
                "preconditionsValidated": ordinal == 1,
                "completeMirror": ordinal == len(MIRROR_OPERATION_IDS),
                "stage": min(stage, len(MIRROR_OPERATION_IDS)),
                "targetId": definition.target_id,
                "modifierId": definition.modifier_id,
                "modifierCreated": stage >= 6,
                "settingsApplied": stage >= 7,
                "resolvedModifierName": (
                    definition.modifier_name if stage >= 7 else None
                ),
                "rnaMirrorModifierMutations": list(rna_mutations),
            },
        },
    }


def resume_mirror_transaction(
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
            "A resumed Mirror transaction requires its receipt and fingerprint"
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
        raise RuntimeError("Guided Mirror transaction binding changed")
    resources = _validate_stage(
        receipts,
        transaction.receipt,
        definition,
        completed_operations,
        deps,
    )
    if _fingerprint(receipts, definition, deps) != transaction.fingerprint:
        raise RuntimeError("Guided Mirror transaction fingerprint changed")
    return resources


def verify_mirror_stage(
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
        ordinal in MIRROR_MUTATING_ORDINALS for ordinal in completed_operations
    )
    if receipt_required:
        if rebound_partial is None:
            raise RuntimeError("Mirror partial receipt is unavailable")
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
            raise RuntimeError("Mirror pre-mutation stage contains a receipt")
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
            raise RuntimeError("Mirror stage fingerprint changed")
    return True


def execute_mirror_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction | None = None,
) -> GuidedGeometryOperationResult:
    if action_name != MIRROR_ACTION:
        raise ValueError(f"Unsupported guided Mirror action: {action_name}")
    if not 1 <= operation_ordinal <= len(MIRROR_OPERATION_IDS):
        raise ValueError("operation_ordinal must be in [1, 7]")
    deps = _dependencies()
    expected_completed = tuple(range(1, operation_ordinal))
    if transaction is None:
        if operation_ordinal != 1:
            raise RuntimeError("Guided Mirror operation 01 must start the transaction")
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
        elif operation_ordinal == 6:
            receipt, rna_mutations = _create_modifier_for_receipt(
                receipt, receipts, definition, deps
            )
        elif operation_ordinal == 7:
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
            if operation_ordinal == 6 and receipt.mutations:
                receipt = _remove_modifier(receipt, definition, deps)
            elif operation_ordinal == 7:
                _validate_stage(
                    receipts, receipt, definition, expected_completed, deps
                )
            if _fingerprint(receipts, definition, deps) != before:
                raise RuntimeError("Mirror compensation fingerprint changed")
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                "Guided Mirror forward operation "
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


def inverse_mirror_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction,
) -> GuidedGeometryOperationResult:
    if action_name != MIRROR_ACTION:
        raise ValueError(f"Unsupported guided Mirror action: {action_name}")
    if (
        not transaction.completed_operations
        or transaction.completed_operations[-1] != operation_ordinal
    ):
        raise RuntimeError("Guided Mirror inverse must target the latest operation")
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
    if operation_ordinal == 7:
        receipt = _reset_modifier(receipt, definition, deps)
    elif operation_ordinal == 6:
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
    "MIRROR_ACTION",
    "MIRROR_MUTATING_ORDINALS",
    "MIRROR_OPERATION_IDS",
    "execute_mirror_operation",
    "inverse_mirror_operation",
    "resume_mirror_transaction",
    "verify_mirror_stage",
)
