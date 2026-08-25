"""Operation-level execution for one bounded Principled material guide leaf."""

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


SINGLE_MATERIAL_ACTION = "blender.material.create_and_assign"
SINGLE_MATERIAL_OPERATION_IDS = (
    "workspace.shading",
    "panel.material_properties",
    "control.new_material",
    "semantic.principled_surface",
)
SINGLE_MATERIAL_MUTATING_ORDINALS = frozenset({3, 4})
_SINGLE_MATERIAL_EXECUTE_TOOL = (
    "operatingline.blender.material.single.execute-next"
)


def _dependencies() -> SimpleNamespace:
    from ..application.session import MaterialSurfaceState, MutationRecord
    from .snowman_actions.common import (
        build_resource_registry,
        ensure_logical_ids_available,
        ensure_name_available,
        ensure_receipts_intact,
        journal_created_resource,
        make_receipt,
        mesh_content_signature,
        rebind_receipts_after_native_restore,
        reference_data_block,
        resolve_data_block,
        resolve_resource,
        restore_material_surface,
        rollback_partial,
        rollback_receipt,
        snapshot_material_surface,
    )
    from .snowman_actions.node_access import (
        require_unique_input,
        require_unique_node,
    )

    return SimpleNamespace(
        MaterialSurfaceState=MaterialSurfaceState,
        MutationRecord=MutationRecord,
        build_resource_registry=build_resource_registry,
        ensure_logical_ids_available=ensure_logical_ids_available,
        ensure_name_available=ensure_name_available,
        ensure_receipts_intact=ensure_receipts_intact,
        journal_created_resource=journal_created_resource,
        make_receipt=make_receipt,
        mesh_content_signature=mesh_content_signature,
        rebind_receipts_after_native_restore=rebind_receipts_after_native_restore,
        reference_data_block=reference_data_block,
        require_unique_input=require_unique_input,
        require_unique_node=require_unique_node,
        resolve_data_block=resolve_data_block,
        resolve_resource=resolve_resource,
        restore_material_surface=restore_material_surface,
        rollback_partial=rollback_partial,
        rollback_receipt=rollback_receipt,
        snapshot_material_surface=snapshot_material_surface,
    )


def _bpy() -> Any:
    import bpy

    return bpy


def _digest(value: Any) -> str:
    return hashlib.sha256(repr(value).encode("utf-8")).hexdigest()


def _definition_fingerprint(definition: Any) -> str:
    return _digest(
        (
            definition.logical_id,
            definition.name,
            tuple(definition.targets),
            tuple(float(channel) for channel in definition.base_color),
            float(definition.roughness),
            float(definition.metallic),
        )
    )


def _pending_material_name(receipt_id: str) -> str:
    return f"OperatingLine.PendingMaterial.{receipt_id[:8]}"


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


def _owned_targets(
    receipts: Mapping[str, Any], definition: Any, deps: Any
) -> tuple[tuple[Any, Any, Any, Any], ...]:
    registry = deps.build_resource_registry(receipts)
    targets: list[tuple[Any, Any, Any, Any]] = []
    for target_id in definition.targets:
        target_identity = registry.get(target_id)
        target = (
            deps.resolve_resource(target_identity)
            if target_identity is not None
            else None
        )
        if (
            target_identity is None
            or target_identity.resource_type != "OBJECT"
            or target is None
            or getattr(target, "type", None) != "MESH"
        ):
            raise ValueError(
                f"Material target is not an owned mesh object: {target_id}"
            )
        mesh = target.data
        mesh_identities = tuple(
            identity
            for identity in registry.values()
            if identity.resource_type == "MESH"
            and deps.resolve_resource(identity) is mesh
        )
        if len(mesh_identities) != 1:
            raise RuntimeError(
                "Material target must bind exactly one owned mesh data-block: "
                f"{target_id}"
            )
        targets.append((target_identity, target, mesh_identities[0], mesh))
    return tuple(targets)


def _validate_base_state(
    receipts: Mapping[str, Any], definition: Any, receipt_id: str, deps: Any
) -> tuple[tuple[Any, Any, Any, Any], ...]:
    deps.ensure_receipts_intact(receipts)
    registry = deps.build_resource_registry(receipts)
    deps.ensure_logical_ids_available(registry, (definition.logical_id,))
    deps.ensure_name_available(_bpy().data.materials, definition.name, "material")
    deps.ensure_name_available(
        _bpy().data.materials,
        _pending_material_name(receipt_id),
        "material",
    )
    return _owned_targets(receipts, definition, deps)


def _material_binding(receipt: Any, definition: Any, deps: Any) -> tuple[Any, Any]:
    if len(receipt.created) != 1:
        raise RuntimeError("Partial material receipt must own exactly one material")
    identity = receipt.created[0]
    material = deps.resolve_resource(identity)
    if (
        identity.resource_type != "MATERIAL"
        or identity.logical_id != definition.logical_id
        or material is None
    ):
        raise RuntimeError("Partial material receipt binding changed")
    return identity, material


def _surface_mutation(receipt: Any, definition: Any, deps: Any) -> Any:
    matches = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.resource.logical_id == definition.logical_id
        and mutation.attribute == "material_surface"
        and isinstance(mutation.after, deps.MaterialSurfaceState)
    )
    if len(matches) != 1:
        raise RuntimeError(
            "Partial material receipt must contain one material surface state"
        )
    return matches[0]


def _same_number(actual: Any, expected: float) -> bool:
    return bool(
        isinstance(actual, (int, float))
        and not isinstance(actual, bool)
        and math.isclose(
            float(actual),
            float(expected),
            rel_tol=1e-6,
            abs_tol=1e-6,
        )
    )


def _same_vector(actual: Any, expected: Any) -> bool:
    return bool(
        len(actual) == len(expected)
        and all(_same_number(value, target) for value, target in zip(actual, expected))
    )


def _material_matches_definition(material: Any, definition: Any, deps: Any) -> bool:
    state = deps.snapshot_material_surface(material)
    return bool(
        state.display_name == definition.name
        and state.use_nodes
        and _same_vector(state.diffuse_color, definition.base_color)
        and _same_number(state.roughness, definition.roughness)
        and _same_number(state.metallic, definition.metallic)
        and _same_vector(state.principled_base_color, definition.base_color)
        and _same_number(state.principled_roughness, definition.roughness)
        and _same_number(state.principled_metallic, definition.metallic)
    )


def _slot_signature(target: Any) -> tuple[Any, ...]:
    return tuple(
        None
        if slot.material is None
        else (
            slot.material.name,
            int(slot.material.session_uid),
            int(slot.material.as_pointer()),
        )
        for slot in target.material_slots
    )


def _fingerprint(
    receipts: Mapping[str, Any], definition: Any, receipt: Any, deps: Any
) -> str:
    _bpy().context.view_layer.update()
    targets = _owned_targets(receipts, definition, deps)
    material_signature = None
    if receipt.created:
        _identity, material = _material_binding(receipt, definition, deps)
        material_signature = (
            int(material.as_pointer()),
            int(material.session_uid),
            deps.snapshot_material_surface(material),
        )
    return _digest(
        (
            material_signature,
            tuple(
                (
                    definition.targets[index],
                    target.name,
                    mesh.name,
                    deps.mesh_content_signature(mesh),
                    _slot_signature(target),
                )
                for index, (_identity, target, _mesh_identity, mesh) in enumerate(
                    targets
                )
            ),
        )
    )


def _validate_assignment_mutations(
    receipt: Any,
    definition: Any,
    material_identity: Any,
    targets: tuple[tuple[Any, Any, Any, Any], ...],
    deps: Any,
) -> None:
    mutations = receipt.mutations[1:]
    if len(mutations) != 3 * len(targets):
        raise RuntimeError("Partial material assignment mutation set changed")
    for index, (target_identity, target, mesh_identity, mesh) in enumerate(targets):
        data_guard, content_guard, slot_mutation = mutations[index * 3 : index * 3 + 3]
        checks = {
            "data_guard": data_guard.resource == target_identity
            and data_guard.attribute == "data"
            and data_guard.before == mesh_identity
            and data_guard.after == mesh_identity
            and target.data is mesh,
            "content_guard": content_guard.resource == mesh_identity
            and content_guard.attribute == "mesh_content"
            and content_guard.before == content_guard.after
            and content_guard.after == deps.mesh_content_signature(mesh),
            "slot_mutation": slot_mutation.resource == target_identity
            and slot_mutation.attribute == "material_slots"
            and slot_mutation.after == (material_identity,)
            and tuple(slot.material for slot in target.material_slots)
            == (deps.resolve_resource(material_identity),),
        }
        failed = tuple(name for name, passed in checks.items() if not passed)
        if failed:
            raise RuntimeError(
                "Partial material target binding changed: "
                f"{definition.targets[index]} ({', '.join(failed)})"
            )


def _validate_stage(
    receipts: Mapping[str, Any],
    receipt: Any,
    definition: Any,
    completed_operations: tuple[int, ...],
    deps: Any,
) -> tuple[tuple[Any, Any, Any, Any], ...]:
    stage = completed_operations[-1] if completed_operations else 0
    targets = _owned_targets(receipts, definition, deps)
    if not targets or receipt.anchor != targets[0][0] or receipt.artifacts:
        raise RuntimeError("Partial material receipt anchor changed")
    if stage < 3:
        _validate_base_state(receipts, definition, receipt.receipt_id, deps)
        if receipt.created or receipt.mutations:
            raise RuntimeError("Material pre-mutation receipt changed")
        return targets

    combined_receipts = dict(receipts)
    combined_receipts["__guided_single_material_partial__"] = receipt
    deps.ensure_receipts_intact(combined_receipts)
    material_identity, material = _material_binding(receipt, definition, deps)
    surface_mutation = _surface_mutation(receipt, definition, deps)
    pending_name = _pending_material_name(receipt.receipt_id)
    checks = {
        "surface_resource": surface_mutation.resource == material_identity,
        "surface_before": (
            surface_mutation.before is None
            if stage == 3
            else isinstance(surface_mutation.before, deps.MaterialSurfaceState)
            and surface_mutation.before.display_name == pending_name
        ),
        "surface_after": deps.snapshot_material_surface(material)
        == surface_mutation.after,
        "name": material.name == (pending_name if stage == 3 else definition.name),
        "nodes": bool(material.use_nodes),
        "settings": stage == 3
        or _material_matches_definition(material, definition, deps),
    }
    failed = tuple(name for name, passed in checks.items() if not passed)
    if failed:
        raise RuntimeError(
            "Partial material surface state changed: " + ", ".join(failed)
        )
    if stage == 3:
        if len(receipt.mutations) != 1:
            raise RuntimeError("Partial material creation mutation set changed")
    else:
        _validate_assignment_mutations(
            receipt,
            definition,
            material_identity,
            targets,
            deps,
        )
    return targets


def _create_material_for_receipt(
    receipt: Any,
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    targets = _validate_base_state(receipts, definition, receipt.receipt_id, deps)
    pending_name = _pending_material_name(receipt.receipt_id)
    created: list[Any] = []
    mutations: list[Any] = []
    material = None
    try:
        material = _bpy().data.materials.new(pending_name)
        identity = deps.journal_created_resource(
            created,
            material,
            definition.logical_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
        )
        before_use_nodes = bool(material.use_nodes)
        material.use_nodes = True
        surface_state = deps.snapshot_material_surface(material)
        mutations.append(
            deps.MutationRecord(
                identity,
                "material_surface",
                None,
                surface_state,
            )
        )
        if material.name != pending_name or not material.use_nodes:
            raise RuntimeError("Material RNA creation readback changed")
        updated = deps.make_receipt(
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            created,
            mutations,
            [],
            targets[0][0],
        )
        evidence = (
            {
                "order": 1,
                "executionMethod": "blender_rna_material_create",
                "mcpTool": _SINGLE_MATERIAL_EXECUTE_TOOL,
                "sourceOperationId": SINGLE_MATERIAL_OPERATION_IDS[2],
                "semanticAction": SINGLE_MATERIAL_OPERATION_IDS[2],
                "valueSource": "managed_receipt_identity",
                "mutationKind": "material_create",
                "materialId": definition.logical_id,
                "pendingMaterialName": pending_name,
                "resourceType": material.bl_rna.identifier,
                "observedResource": True,
                "uiPath": [
                    "Shading",
                    "Material Properties",
                    "New",
                    pending_name,
                ],
            },
            {
                "order": 2,
                "executionMethod": "blender_rna_material_use_nodes_write",
                "mcpTool": _SINGLE_MATERIAL_EXECUTE_TOOL,
                "sourceOperationId": SINGLE_MATERIAL_OPERATION_IDS[2],
                "semanticAction": SINGLE_MATERIAL_OPERATION_IDS[2],
                "valueSource": "catalog_constant",
                "mutationKind": "material_use_nodes_write",
                "materialId": definition.logical_id,
                "beforeValue": before_use_nodes,
                "acceptedValue": True,
                "observedValue": bool(material.use_nodes),
                "uiPath": [
                    "Shading",
                    "Material Properties",
                    pending_name,
                    "Use Nodes",
                ],
            },
        )
        return updated, evidence
    except Exception:
        if created or mutations:
            deps.rollback_partial(
                receipt.receipt_id,
                receipt.step_id,
                receipt.action_name,
                created,
                mutations,
                [],
            )
        elif material is not None:
            _bpy().data.materials.remove(material)
        raise


def _surface_controls(material: Any, deps: Any) -> tuple[Any, Any, Any, Any]:
    principled = deps.require_unique_node(
        material.node_tree,
        "ShaderNodeBsdfPrincipled",
        f"Material {material.name!r}",
    )
    deps.require_unique_node(
        material.node_tree,
        "ShaderNodeOutputMaterial",
        f"Material {material.name!r}",
    )
    return (
        principled,
        deps.require_unique_input(
            principled,
            "Base Color",
            "ShaderNodeBsdfPrincipled",
        ),
        deps.require_unique_input(
            principled,
            "Roughness",
            "ShaderNodeBsdfPrincipled",
        ),
        deps.require_unique_input(
            principled,
            "Metallic",
            "ShaderNodeBsdfPrincipled",
        ),
    )


def _control_evidence(
    *,
    order: int,
    execution_method: str,
    mutation_kind: str,
    definition: Any,
    action_argument: str,
    surface: str,
    property_name: str,
    before: Any,
    accepted: Any,
    observed: Any,
    component: str | None = None,
) -> dict[str, Any]:
    evidence = {
        "order": order,
        "executionMethod": execution_method,
        "mcpTool": _SINGLE_MATERIAL_EXECUTE_TOOL,
        "sourceOperationId": SINGLE_MATERIAL_OPERATION_IDS[3],
        "semanticAction": SINGLE_MATERIAL_OPERATION_IDS[3],
        "valueSource": "accepted_action_argument",
        "actionArgument": action_argument,
        "mutationKind": mutation_kind,
        "materialId": definition.logical_id,
        "materialName": definition.name,
        "surface": surface,
        "propertyName": property_name,
        "beforeValue": before,
        "acceptedValue": accepted,
        "observedValue": observed,
        "uiPath": [
            "Shading",
            "Material Properties",
            definition.name,
            surface,
            property_name,
            *(() if component is None else (component,)),
        ],
    }
    if component is not None:
        evidence["component"] = component
    return evidence


def _write_scalar(
    *,
    owner: Any,
    attribute: str,
    accepted: float,
    evidence: list[dict[str, Any]],
    execution_method: str,
    mutation_kind: str,
    definition: Any,
    action_argument: str,
    surface: str,
    property_name: str,
) -> None:
    before = float(getattr(owner, attribute))
    setattr(owner, attribute, float(accepted))
    observed = float(getattr(owner, attribute))
    if not _same_number(observed, accepted):
        raise RuntimeError(f"Material RNA readback changed: {property_name}")
    evidence.append(
        _control_evidence(
            order=len(evidence) + 1,
            execution_method=execution_method,
            mutation_kind=mutation_kind,
            definition=definition,
            action_argument=action_argument,
            surface=surface,
            property_name=property_name,
            before=before,
            accepted=float(accepted),
            observed=observed,
        )
    )


def _write_vector_components(
    *,
    vector_value: Any,
    accepted: Any,
    evidence: list[dict[str, Any]],
    execution_method: str,
    mutation_kind: str,
    definition: Any,
    action_argument: str,
    surface: str,
    property_name: str,
) -> None:
    for index, component in enumerate(("R", "G", "B", "A")):
        before = float(vector_value[index])
        vector_value[index] = float(accepted[index])
        observed = float(vector_value[index])
        if not _same_number(observed, accepted[index]):
            raise RuntimeError(
                f"Material RNA readback changed: {property_name}.{component}"
            )
        evidence.append(
            _control_evidence(
                order=len(evidence) + 1,
                execution_method=execution_method,
                mutation_kind=mutation_kind,
                definition=definition,
                action_argument=action_argument,
                surface=surface,
                property_name=property_name,
                component=component,
                before=before,
                accepted=float(accepted[index]),
                observed=observed,
            )
        )


def _restore_slots(target: Any, before: tuple[Any, ...], deps: Any) -> None:
    target.data.materials.clear()
    for reference in before:
        if reference is None:
            continue
        material = deps.resolve_data_block(reference)
        if material is None:
            raise RuntimeError("Material slot rollback dependency is unavailable")
        target.data.materials.append(material)


def _configure_and_assign(
    receipt: Any,
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    targets = _validate_stage(receipts, receipt, definition, (1, 2, 3), deps)
    material_identity, material = _material_binding(receipt, definition, deps)
    surface_mutation = _surface_mutation(receipt, definition, deps)
    before_surface = surface_mutation.after
    evidence: list[dict[str, Any]] = []
    completed_assignment_mutations: list[Any] = []
    current_target: Any | None = None
    current_before: tuple[Any, ...] | None = None
    configured_mutation: Any | None = None
    try:
        before_name = material.name
        material.name = definition.name
        if material.name != definition.name:
            raise RuntimeError("Material RNA name readback changed")
        evidence.append(
            _control_evidence(
                order=1,
                execution_method="blender_rna_material_name_write",
                mutation_kind="material_name_write",
                definition=definition,
                action_argument="materialName",
                surface="Material",
                property_name="name",
                before=before_name,
                accepted=definition.name,
                observed=material.name,
            )
        )
        _write_vector_components(
            vector_value=material.diffuse_color,
            accepted=definition.base_color,
            evidence=evidence,
            execution_method="blender_rna_material_property_write",
            mutation_kind="material_property_write",
            definition=definition,
            action_argument="baseColor",
            surface="Material",
            property_name="diffuse_color",
        )
        _write_scalar(
            owner=material,
            attribute="roughness",
            accepted=definition.roughness,
            evidence=evidence,
            execution_method="blender_rna_material_property_write",
            mutation_kind="material_property_write",
            definition=definition,
            action_argument="roughness",
            surface="Material",
            property_name="roughness",
        )
        _write_scalar(
            owner=material,
            attribute="metallic",
            accepted=definition.metallic,
            evidence=evidence,
            execution_method="blender_rna_material_property_write",
            mutation_kind="material_property_write",
            definition=definition,
            action_argument="metallic",
            surface="Material",
            property_name="metallic",
        )
        _principled, base_color, roughness, metallic = _surface_controls(
            material, deps
        )
        _write_vector_components(
            vector_value=base_color.default_value,
            accepted=definition.base_color,
            evidence=evidence,
            execution_method="blender_rna_principled_input_write",
            mutation_kind="principled_input_write",
            definition=definition,
            action_argument="baseColor",
            surface="Principled BSDF",
            property_name="Base Color",
        )
        _write_scalar(
            owner=roughness,
            attribute="default_value",
            accepted=definition.roughness,
            evidence=evidence,
            execution_method="blender_rna_principled_input_write",
            mutation_kind="principled_input_write",
            definition=definition,
            action_argument="roughness",
            surface="Principled BSDF",
            property_name="Roughness",
        )
        _write_scalar(
            owner=metallic,
            attribute="default_value",
            accepted=definition.metallic,
            evidence=evidence,
            execution_method="blender_rna_principled_input_write",
            mutation_kind="principled_input_write",
            definition=definition,
            action_argument="metallic",
            surface="Principled BSDF",
            property_name="Metallic",
        )
        after_surface = deps.snapshot_material_surface(material)
        if not _material_matches_definition(material, definition, deps):
            raise RuntimeError("Material fixed surface contract changed")
        configured_mutation = deps.MutationRecord(
            material_identity,
            "material_surface",
            before_surface,
            after_surface,
        )

        for index, (target_identity, target, mesh_identity, mesh) in enumerate(
            targets
        ):
            current_target = target
            current_before = tuple(
                deps.reference_data_block(slot.material)
                if slot.material is not None
                else None
                for slot in target.material_slots
            )
            source_content = deps.mesh_content_signature(mesh)
            target.data.materials.clear()
            target.data.materials.append(material)
            if tuple(slot.material for slot in target.material_slots) != (material,):
                raise RuntimeError(
                    f"Material slot RNA readback changed: {definition.targets[index]}"
                )
            completed_assignment_mutations.extend(
                (
                    deps.MutationRecord(
                        target_identity,
                        "data",
                        mesh_identity,
                        mesh_identity,
                    ),
                    deps.MutationRecord(
                        mesh_identity,
                        "mesh_content",
                        source_content,
                        source_content,
                    ),
                    deps.MutationRecord(
                        target_identity,
                        "material_slots",
                        current_before,
                        (material_identity,),
                    ),
                )
            )
            evidence.append(
                {
                    "order": len(evidence) + 1,
                    "executionMethod": "blender_rna_material_slot_replace",
                    "mcpTool": _SINGLE_MATERIAL_EXECUTE_TOOL,
                    "sourceOperationId": SINGLE_MATERIAL_OPERATION_IDS[3],
                    "semanticAction": SINGLE_MATERIAL_OPERATION_IDS[3],
                    "valueSource": "accepted_action_argument",
                    "actionArgument": "targets",
                    "mutationKind": "material_slot_replace",
                    "targetOrder": index + 1,
                    "targetId": definition.targets[index],
                    "materialId": definition.logical_id,
                    "beforeSlotCount": len(current_before),
                    "observedSlotCount": len(target.material_slots),
                    "observedAssignment": True,
                    "sourceMeshId": mesh_identity.logical_id,
                    "sourceContentIntact": deps.mesh_content_signature(mesh)
                    == source_content,
                    "uiPath": [
                        "Shading",
                        "Material Properties",
                        definition.targets[index],
                        "Material Slots",
                        definition.name,
                    ],
                }
            )
            current_target = None
            current_before = None

        return (
            replace(
                receipt,
                mutations=(configured_mutation, *completed_assignment_mutations),
            ),
            tuple(evidence),
        )
    except Exception as error:
        try:
            if current_target is not None and current_before is not None:
                _restore_slots(current_target, current_before, deps)
            if configured_mutation is not None:
                mini_receipt = deps.make_receipt(
                    receipt.receipt_id,
                    receipt.step_id,
                    receipt.action_name,
                    [],
                    [configured_mutation, *completed_assignment_mutations],
                    [],
                    receipt.anchor,
                )
                deps.rollback_receipt(mini_receipt, allow_incomplete=True)
            else:
                deps.restore_material_surface(material, before_surface)
            if deps.snapshot_material_surface(material) != before_surface:
                raise RuntimeError("Material surface compensation changed")
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                "Material configuration failed and its prior state was not restored"
            ) from recovery_error
        raise error


def _reset_material(receipt: Any, definition: Any, deps: Any) -> Any:
    surface_mutation = _surface_mutation(receipt, definition, deps)
    if not isinstance(surface_mutation.before, deps.MaterialSurfaceState):
        raise RuntimeError("Configured material baseline is unavailable")
    mini_receipt = deps.make_receipt(
        receipt.receipt_id,
        receipt.step_id,
        receipt.action_name,
        [],
        list(receipt.mutations),
        [],
        receipt.anchor,
    )
    deps.rollback_receipt(mini_receipt)
    return replace(
        receipt,
        mutations=(
            deps.MutationRecord(
                surface_mutation.resource,
                "material_surface",
                None,
                surface_mutation.before,
            ),
        ),
    )


def _remove_material(receipt: Any, definition: Any, deps: Any) -> Any:
    _material_binding(receipt, definition, deps)
    target_identity = receipt.anchor
    deps.rollback_receipt(receipt)
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
        "kind": "guided_material_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": direction,
            "operationOrdinal": ordinal,
            "operationId": SINGLE_MATERIAL_OPERATION_IDS[ordinal - 1],
            "mutating": ordinal in SINGLE_MATERIAL_MUTATING_ORDINALS,
            "receiptId": receipt.receipt_id,
            "stepId": receipt.step_id,
            "actionName": receipt.action_name,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(completed),
                "preconditionsValidated": ordinal == 1,
                "completeSingleMaterial": ordinal
                == len(SINGLE_MATERIAL_OPERATION_IDS),
                "stage": min(stage, len(SINGLE_MATERIAL_OPERATION_IDS)),
                "materialId": definition.logical_id,
                "targetIds": list(definition.targets),
                "materialCreated": stage >= 3,
                "surfaceConfigured": stage >= 4,
                "assignmentsApplied": stage >= 4,
                "resolvedMaterialName": definition.name if stage >= 4 else None,
                "rnaMaterialMutations": list(rna_mutations),
            },
        },
    }


def resume_single_material_transaction(
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
            "A resumed material transaction requires its receipt and fingerprint"
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
        raise RuntimeError("Guided material transaction binding changed")
    _validate_stage(
        receipts,
        transaction.receipt,
        definition,
        completed_operations,
        deps,
    )
    if (
        _fingerprint(receipts, definition, transaction.receipt, deps)
        != transaction.fingerprint
    ):
        raise RuntimeError("Guided material transaction fingerprint changed")


def verify_single_material_stage(
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
        ordinal in SINGLE_MATERIAL_MUTATING_ORDINALS
        for ordinal in completed_operations
    )
    if receipt_required:
        if rebound_partial is None:
            raise RuntimeError("Material partial receipt is unavailable")
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
            raise RuntimeError("Material pre-mutation stage contains a receipt")
        targets = _owned_targets(rebound_receipts, definition, deps)
        receipt = _empty_receipt(
            receipt_id,
            step_id,
            action_name,
            targets[0][0],
            deps,
        )
        _validate_stage(
            rebound_receipts,
            receipt,
            definition,
            completed_operations,
            deps,
        )
        if (
            _fingerprint(rebound_receipts, definition, receipt, deps)
            != expected_fingerprint
        ):
            raise RuntimeError("Material stage fingerprint changed")
    return True


def execute_single_material_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction | None = None,
) -> GuidedGeometryOperationResult:
    if action_name != SINGLE_MATERIAL_ACTION:
        raise ValueError(f"Unsupported guided material action: {action_name}")
    if not 1 <= operation_ordinal <= len(SINGLE_MATERIAL_OPERATION_IDS):
        raise ValueError("operation_ordinal must be in [1, 4]")
    deps = _dependencies()
    expected_completed = tuple(range(1, operation_ordinal))
    if transaction is None:
        if operation_ordinal != 1:
            raise RuntimeError("Guided material operation 01 must start the transaction")
        targets = _owned_targets(receipts, definition, deps)
        receipt = _empty_receipt(
            receipt_id,
            step_id,
            action_name,
            targets[0][0],
            deps,
        )
        before = _fingerprint(receipts, definition, receipt, deps)
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
            receipt, rna_mutations = _create_material_for_receipt(
                receipt, receipts, definition, deps
            )
        elif operation_ordinal == 4:
            receipt, rna_mutations = _configure_and_assign(
                receipt, receipts, definition, deps
            )
        else:
            _validate_stage(
                receipts,
                receipt,
                definition,
                expected_completed,
                deps,
            )
        completed = (*expected_completed, operation_ordinal)
        _validate_stage(receipts, receipt, definition, completed, deps)
    except GuidedGeometryAtomicityError:
        raise
    except Exception as error:
        try:
            if operation_ordinal == 3 and receipt.created:
                receipt = _remove_material(receipt, definition, deps)
            elif operation_ordinal == 4:
                _validate_stage(
                    receipts,
                    receipt,
                    definition,
                    expected_completed,
                    deps,
                )
            if _fingerprint(receipts, definition, receipt, deps) != before:
                raise RuntimeError("Material compensation fingerprint changed")
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                "Guided material forward operation "
                f"{operation_ordinal:02d} failed and rollback failed"
            ) from recovery_error
        raise error

    after = _fingerprint(receipts, definition, receipt, deps)
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


def inverse_single_material_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction,
) -> GuidedGeometryOperationResult:
    if action_name != SINGLE_MATERIAL_ACTION:
        raise ValueError(f"Unsupported guided material action: {action_name}")
    if (
        not transaction.completed_operations
        or transaction.completed_operations[-1] != operation_ordinal
    ):
        raise RuntimeError("Guided material inverse must target the latest operation")
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
        receipt = _reset_material(receipt, definition, deps)
    elif operation_ordinal == 3:
        receipt = _remove_material(receipt, definition, deps)
    completed = transaction.completed_operations[:-1]
    _validate_stage(receipts, receipt, definition, completed, deps)
    after = _fingerprint(receipts, definition, receipt, deps)
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
    "SINGLE_MATERIAL_ACTION",
    "SINGLE_MATERIAL_MUTATING_ORDINALS",
    "SINGLE_MATERIAL_OPERATION_IDS",
    "execute_single_material_operation",
    "inverse_single_material_operation",
    "resume_single_material_transaction",
    "verify_single_material_stage",
)
