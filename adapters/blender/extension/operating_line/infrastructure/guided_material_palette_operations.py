"""Operation-level execution for one bounded Principled material palette leaf."""

from __future__ import annotations

import hashlib
import math
from types import SimpleNamespace
from typing import Any, Mapping

from .guided_geometry_operations import (
    GuidedGeometryAtomicityError,
    GuidedGeometryOperationResult,
    GuidedGeometryTransaction,
)


MATERIAL_PALETTE_ACTION = "blender.material.create_palette_and_assign"
MATERIAL_PALETTE_OPERATION_IDS = (
    "workspace.shading",
    "panel.material_properties",
    "semantic.palette_entries",
    "semantic.assign_targets",
)
MATERIAL_PALETTE_MUTATING_ORDINALS = frozenset({4})
_MATERIAL_PALETTE_EXECUTE_TOOL = (
    "operatingline.blender.material.palette.execute-next"
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
        rollback_partial=rollback_partial,
        rollback_receipt=rollback_receipt,
        snapshot_material_surface=snapshot_material_surface,
    )


def _bpy() -> Any:
    import bpy

    return bpy


def _digest(value: Any) -> str:
    return hashlib.sha256(repr(value).encode("utf-8")).hexdigest()


def _definition_fingerprint(definitions: tuple[Any, ...]) -> str:
    return _digest(
        tuple(
            (
                definition.logical_id,
                definition.name,
                tuple(definition.targets),
                tuple(float(channel) for channel in definition.base_color),
                float(definition.roughness),
                float(definition.metallic),
            )
            for definition in definitions
        )
    )


def _empty_receipt(
    receipt_id: str,
    step_id: str,
    action_name: str,
    anchor: Any,
    deps: Any,
) -> Any:
    return deps.make_receipt(
        receipt_id,
        step_id,
        action_name,
        [],
        [],
        [],
        anchor,
    )


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


def _owned_targets(
    receipts: Mapping[str, Any],
    definitions: tuple[Any, ...],
    deps: Any,
) -> tuple[tuple[tuple[Any, Any, Any, Any], ...], ...]:
    registry = deps.build_resource_registry(receipts)
    resolved: list[tuple[tuple[Any, Any, Any, Any], ...]] = []
    for definition in definitions:
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
        resolved.append(tuple(targets))
    return tuple(resolved)


def _validate_base_state(
    receipts: Mapping[str, Any],
    definitions: tuple[Any, ...],
    deps: Any,
) -> tuple[tuple[tuple[Any, Any, Any, Any], ...], ...]:
    if not definitions:
        raise ValueError("Material palette must contain at least one definition")
    deps.ensure_receipts_intact(receipts)
    registry = deps.build_resource_registry(receipts)
    deps.ensure_logical_ids_available(
        registry,
        (definition.logical_id for definition in definitions),
    )
    for definition in definitions:
        deps.ensure_name_available(_bpy().data.materials, definition.name, "material")
    return _owned_targets(receipts, definitions, deps)


def _material_binding(
    receipt: Any,
    definition: Any,
    material_order: int,
    deps: Any,
) -> tuple[Any, Any]:
    if len(receipt.created) <= material_order - 1:
        raise RuntimeError("Palette receipt material count changed")
    identity = receipt.created[material_order - 1]
    material = deps.resolve_resource(identity)
    if (
        identity.resource_type != "MATERIAL"
        or identity.logical_id != definition.logical_id
        or material is None
    ):
        raise RuntimeError("Palette material receipt binding changed")
    return identity, material


def _surface_controls(material: Any, deps: Any) -> tuple[Any, Any, Any]:
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


def _fingerprint(
    receipts: Mapping[str, Any],
    definitions: tuple[Any, ...],
    receipt: Any,
    deps: Any,
) -> str:
    _bpy().context.view_layer.update()
    target_groups = _owned_targets(receipts, definitions, deps)
    material_signatures: list[Any] = []
    if receipt.created:
        for material_order, definition in enumerate(definitions, start=1):
            _identity, material = _material_binding(
                receipt,
                definition,
                material_order,
                deps,
            )
            material_signatures.append(
                (
                    int(material.as_pointer()),
                    int(material.session_uid),
                    deps.snapshot_material_surface(material),
                )
            )
    target_signatures = tuple(
        (
            definition.targets[target_index],
            target.name,
            mesh.name,
            deps.mesh_content_signature(mesh),
            _slot_signature(target),
        )
        for definition, targets in zip(definitions, target_groups)
        for target_index, (_identity, target, _mesh_identity, mesh) in enumerate(
            targets
        )
    )
    return _digest((tuple(material_signatures), target_signatures))


def _validate_final_stage(
    receipts: Mapping[str, Any],
    receipt: Any,
    definitions: tuple[Any, ...],
    deps: Any,
) -> None:
    target_groups = _owned_targets(receipts, definitions, deps)
    if len(receipt.created) != len(definitions) or receipt.artifacts:
        raise RuntimeError("Palette receipt resource set changed")
    expected_mutation_count = sum(
        1 + 3 * len(definition.targets) for definition in definitions
    )
    if len(receipt.mutations) != expected_mutation_count:
        raise RuntimeError("Palette receipt mutation set changed")
    if not target_groups or not target_groups[0] or receipt.anchor != target_groups[0][0][0]:
        raise RuntimeError("Palette receipt anchor changed")

    combined_receipts = dict(receipts)
    combined_receipts["__guided_material_palette_partial__"] = receipt
    deps.ensure_receipts_intact(combined_receipts)
    cursor = 0
    for material_order, (definition, targets) in enumerate(
        zip(definitions, target_groups),
        start=1,
    ):
        material_identity, material = _material_binding(
            receipt,
            definition,
            material_order,
            deps,
        )
        surface_mutation = receipt.mutations[cursor]
        cursor += 1
        if (
            surface_mutation.resource != material_identity
            or surface_mutation.attribute != "material_surface"
            or surface_mutation.before is not None
            or not isinstance(surface_mutation.after, deps.MaterialSurfaceState)
            or deps.snapshot_material_surface(material) != surface_mutation.after
            or not _material_matches_definition(material, definition, deps)
        ):
            raise RuntimeError(
                f"Palette material surface changed: {definition.logical_id}"
            )
        for target_index, (target_identity, target, mesh_identity, mesh) in enumerate(
            targets
        ):
            data_guard, content_guard, slot_mutation = receipt.mutations[
                cursor : cursor + 3
            ]
            cursor += 3
            if not (
                data_guard.resource == target_identity
                and data_guard.attribute == "data"
                and data_guard.before == mesh_identity
                and data_guard.after == mesh_identity
                and target.data is mesh
                and content_guard.resource == mesh_identity
                and content_guard.attribute == "mesh_content"
                and content_guard.before == content_guard.after
                and content_guard.after == deps.mesh_content_signature(mesh)
                and slot_mutation.resource == target_identity
                and slot_mutation.attribute == "material_slots"
                and slot_mutation.after == (material_identity,)
                and tuple(slot.material for slot in target.material_slots)
                == (material,)
            ):
                raise RuntimeError(
                    "Palette target binding changed: "
                    f"{definition.targets[target_index]}"
                )


def _validate_stage(
    receipts: Mapping[str, Any],
    receipt: Any,
    definitions: tuple[Any, ...],
    completed_operations: tuple[int, ...],
    deps: Any,
) -> None:
    stage = completed_operations[-1] if completed_operations else 0
    target_groups = _owned_targets(receipts, definitions, deps)
    if not target_groups or not target_groups[0] or receipt.anchor != target_groups[0][0][0]:
        raise RuntimeError("Palette receipt anchor changed")
    if stage < 4:
        _validate_base_state(receipts, definitions, deps)
        if receipt.created or receipt.mutations or receipt.artifacts:
            raise RuntimeError("Palette pre-mutation receipt changed")
        return
    _validate_final_stage(receipts, receipt, definitions, deps)


def _evidence_common(
    *,
    evidence: list[dict[str, Any]],
    material_order: int,
    material_mutation_order: int,
    definition: Any,
    execution_method: str,
    mutation_kind: str,
    value_source: str,
    action_argument: str | None,
    ui_path: list[Any],
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "order": len(evidence) + 1,
        "materialOrder": material_order,
        "materialMutationOrder": material_mutation_order,
        "executionMethod": execution_method,
        "mcpTool": _MATERIAL_PALETTE_EXECUTE_TOOL,
        "sourceOperationId": MATERIAL_PALETTE_OPERATION_IDS[3],
        "semanticAction": MATERIAL_PALETTE_OPERATION_IDS[3],
        "valueSource": value_source,
        "mutationKind": mutation_kind,
        "materialId": definition.logical_id,
        "materialName": definition.name,
        "uiPath": ui_path,
    }
    if action_argument is not None:
        result["actionArgument"] = action_argument
    return result


def _control_evidence(
    *,
    evidence: list[dict[str, Any]],
    material_order: int,
    material_mutation_order: int,
    definition: Any,
    execution_method: str,
    mutation_kind: str,
    action_argument: str,
    surface: str,
    property_name: str,
    before: Any,
    accepted: Any,
    observed: Any,
    component: str | None = None,
) -> dict[str, Any]:
    item = _evidence_common(
        evidence=evidence,
        material_order=material_order,
        material_mutation_order=material_mutation_order,
        definition=definition,
        execution_method=execution_method,
        mutation_kind=mutation_kind,
        value_source="accepted_action_argument",
        action_argument=action_argument,
        ui_path=[
            "Shading",
            "Material Properties",
            "Palette",
            material_order,
            definition.name,
            surface,
            property_name,
            *(() if component is None else (component,)),
        ],
    )
    item.update(
        {
            "surface": surface,
            "propertyName": property_name,
            "beforeValue": before,
            "acceptedValue": accepted,
            "observedValue": observed,
        }
    )
    if component is not None:
        item["component"] = component
    return item


def _write_scalar(
    *,
    owner: Any,
    attribute: str,
    accepted: float,
    evidence: list[dict[str, Any]],
    material_order: int,
    material_mutation_order: int,
    definition: Any,
    execution_method: str,
    mutation_kind: str,
    action_argument: str,
    surface: str,
    property_name: str,
) -> int:
    before = float(getattr(owner, attribute))
    setattr(owner, attribute, float(accepted))
    observed = float(getattr(owner, attribute))
    if not _same_number(observed, accepted):
        raise RuntimeError(f"Material palette RNA readback changed: {property_name}")
    evidence.append(
        _control_evidence(
            evidence=evidence,
            material_order=material_order,
            material_mutation_order=material_mutation_order,
            definition=definition,
            execution_method=execution_method,
            mutation_kind=mutation_kind,
            action_argument=action_argument,
            surface=surface,
            property_name=property_name,
            before=before,
            accepted=float(accepted),
            observed=observed,
        )
    )
    return material_mutation_order + 1


def _write_vector_components(
    *,
    vector_value: Any,
    accepted: Any,
    evidence: list[dict[str, Any]],
    material_order: int,
    material_mutation_order: int,
    definition: Any,
    execution_method: str,
    mutation_kind: str,
    action_argument: str,
    surface: str,
    property_name: str,
) -> int:
    for index, component in enumerate(("R", "G", "B", "A")):
        before = float(vector_value[index])
        vector_value[index] = float(accepted[index])
        observed = float(vector_value[index])
        if not _same_number(observed, accepted[index]):
            raise RuntimeError(
                f"Material palette RNA readback changed: {property_name}.{component}"
            )
        evidence.append(
            _control_evidence(
                evidence=evidence,
                material_order=material_order,
                material_mutation_order=material_mutation_order,
                definition=definition,
                execution_method=execution_method,
                mutation_kind=mutation_kind,
                action_argument=action_argument,
                surface=surface,
                property_name=property_name,
                before=before,
                accepted=float(accepted[index]),
                observed=observed,
                component=component,
            )
        )
        material_mutation_order += 1
    return material_mutation_order


def _restore_slots(target: Any, before: tuple[Any, ...], deps: Any) -> None:
    target.data.materials.clear()
    for reference in before:
        if reference is None:
            continue
        material = deps.resolve_data_block(reference)
        if material is None:
            raise RuntimeError("Material slot rollback dependency is unavailable")
        target.data.materials.append(material)


def _create_and_assign_palette(
    receipt: Any,
    receipts: Mapping[str, Any],
    definitions: tuple[Any, ...],
    deps: Any,
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    target_groups = _validate_base_state(receipts, definitions, deps)
    created: list[Any] = []
    mutations: list[Any] = []
    evidence: list[dict[str, Any]] = []
    current_target: Any | None = None
    current_before: tuple[Any, ...] | None = None
    try:
        for material_order, (definition, targets) in enumerate(
            zip(definitions, target_groups),
            start=1,
        ):
            material_mutation_order = 1
            material = _bpy().data.materials.new(definition.name)
            identity = deps.journal_created_resource(
                created,
                material,
                definition.logical_id,
                receipt.receipt_id,
                receipt.step_id,
                receipt.action_name,
            )
            if material.name != definition.name:
                raise RuntimeError("Palette material RNA name readback changed")
            created_evidence = _evidence_common(
                evidence=evidence,
                material_order=material_order,
                material_mutation_order=material_mutation_order,
                definition=definition,
                execution_method="blender_rna_material_create",
                mutation_kind="palette_material_create",
                value_source="accepted_action_argument",
                action_argument="materials[].materialName",
                ui_path=[
                    "Shading",
                    "Material Properties",
                    "Palette",
                    material_order,
                    definition.name,
                    "New",
                ],
            )
            created_evidence.update(
                {"resourceType": material.bl_rna.identifier, "observedResource": True}
            )
            evidence.append(created_evidence)
            material_mutation_order += 1

            before_use_nodes = bool(material.use_nodes)
            material.use_nodes = True
            if not material.use_nodes:
                raise RuntimeError("Palette material Use Nodes readback changed")
            use_nodes_evidence = _evidence_common(
                evidence=evidence,
                material_order=material_order,
                material_mutation_order=material_mutation_order,
                definition=definition,
                execution_method="blender_rna_material_use_nodes_write",
                mutation_kind="palette_material_use_nodes_write",
                value_source="catalog_constant",
                action_argument=None,
                ui_path=[
                    "Shading",
                    "Material Properties",
                    "Palette",
                    material_order,
                    definition.name,
                    "Use Nodes",
                ],
            )
            use_nodes_evidence.update(
                {
                    "beforeValue": before_use_nodes,
                    "acceptedValue": True,
                    "observedValue": bool(material.use_nodes),
                }
            )
            evidence.append(use_nodes_evidence)
            material_mutation_order += 1

            material_mutation_order = _write_vector_components(
                vector_value=material.diffuse_color,
                accepted=definition.base_color,
                evidence=evidence,
                material_order=material_order,
                material_mutation_order=material_mutation_order,
                definition=definition,
                execution_method="blender_rna_material_property_write",
                mutation_kind="palette_material_property_write",
                action_argument="materials[].baseColor",
                surface="Material",
                property_name="diffuse_color",
            )
            material_mutation_order = _write_scalar(
                owner=material,
                attribute="roughness",
                accepted=definition.roughness,
                evidence=evidence,
                material_order=material_order,
                material_mutation_order=material_mutation_order,
                definition=definition,
                execution_method="blender_rna_material_property_write",
                mutation_kind="palette_material_property_write",
                action_argument="materials[].roughness",
                surface="Material",
                property_name="roughness",
            )
            material_mutation_order = _write_scalar(
                owner=material,
                attribute="metallic",
                accepted=definition.metallic,
                evidence=evidence,
                material_order=material_order,
                material_mutation_order=material_mutation_order,
                definition=definition,
                execution_method="blender_rna_material_property_write",
                mutation_kind="palette_material_property_write",
                action_argument="materials[].metallic",
                surface="Material",
                property_name="metallic",
            )
            base_color, roughness, metallic = _surface_controls(material, deps)
            material_mutation_order = _write_vector_components(
                vector_value=base_color.default_value,
                accepted=definition.base_color,
                evidence=evidence,
                material_order=material_order,
                material_mutation_order=material_mutation_order,
                definition=definition,
                execution_method="blender_rna_principled_input_write",
                mutation_kind="palette_principled_input_write",
                action_argument="materials[].baseColor",
                surface="Principled BSDF",
                property_name="Base Color",
            )
            material_mutation_order = _write_scalar(
                owner=roughness,
                attribute="default_value",
                accepted=definition.roughness,
                evidence=evidence,
                material_order=material_order,
                material_mutation_order=material_mutation_order,
                definition=definition,
                execution_method="blender_rna_principled_input_write",
                mutation_kind="palette_principled_input_write",
                action_argument="materials[].roughness",
                surface="Principled BSDF",
                property_name="Roughness",
            )
            material_mutation_order = _write_scalar(
                owner=metallic,
                attribute="default_value",
                accepted=definition.metallic,
                evidence=evidence,
                material_order=material_order,
                material_mutation_order=material_mutation_order,
                definition=definition,
                execution_method="blender_rna_principled_input_write",
                mutation_kind="palette_principled_input_write",
                action_argument="materials[].metallic",
                surface="Principled BSDF",
                property_name="Metallic",
            )
            surface_state = deps.snapshot_material_surface(material)
            if not _material_matches_definition(material, definition, deps):
                raise RuntimeError("Palette material surface contract changed")
            mutations.append(
                deps.MutationRecord(identity, "material_surface", None, surface_state)
            )

            for target_order, (
                target_identity,
                target,
                mesh_identity,
                mesh,
            ) in enumerate(targets, start=1):
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
                        "Palette material slot RNA readback changed: "
                        f"{definition.targets[target_order - 1]}"
                    )
                mutations.extend(
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
                            (identity,),
                        ),
                    )
                )
                assignment_evidence = _evidence_common(
                    evidence=evidence,
                    material_order=material_order,
                    material_mutation_order=material_mutation_order,
                    definition=definition,
                    execution_method="blender_rna_material_slot_replace",
                    mutation_kind="palette_material_slot_replace",
                    value_source="accepted_action_argument",
                    action_argument="materials[].targets",
                    ui_path=[
                        "Shading",
                        "Material Properties",
                        "Palette",
                        material_order,
                        definition.targets[target_order - 1],
                        "Material Slots",
                        definition.name,
                    ],
                )
                assignment_evidence.update(
                    {
                        "targetOrder": target_order,
                        "targetId": definition.targets[target_order - 1],
                        "beforeSlotCount": len(current_before),
                        "observedSlotCount": len(target.material_slots),
                        "observedAssignment": True,
                        "sourceMeshId": mesh_identity.logical_id,
                        "sourceContentIntact": deps.mesh_content_signature(mesh)
                        == source_content,
                    }
                )
                evidence.append(assignment_evidence)
                material_mutation_order += 1
                current_target = None
                current_before = None

        updated = deps.make_receipt(
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            created,
            mutations,
            [],
            target_groups[0][0][0],
        )
        return updated, tuple(evidence)
    except Exception as error:
        try:
            if current_target is not None and current_before is not None:
                _restore_slots(current_target, current_before, deps)
            deps.rollback_partial(
                receipt.receipt_id,
                receipt.step_id,
                receipt.action_name,
                created,
                mutations,
                [],
            )
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                "Material palette execution failed and its prior state was not restored"
            ) from recovery_error
        raise error


def _remove_palette(
    receipt: Any,
    definitions: tuple[Any, ...],
    deps: Any,
) -> Any:
    for material_order, definition in enumerate(definitions, start=1):
        _material_binding(receipt, definition, material_order, deps)
    anchor = receipt.anchor
    deps.rollback_receipt(receipt)
    return _empty_receipt(
        receipt.receipt_id,
        receipt.step_id,
        receipt.action_name,
        anchor,
        deps,
    )


def _observation(
    *,
    ordinal: int,
    direction: str,
    receipt: Any,
    before: str,
    after: str,
    definitions: tuple[Any, ...],
    completed: tuple[int, ...],
    rna_mutations: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    stage = completed[-1] if completed else 0
    target_ids = [
        target_id
        for definition in definitions
        for target_id in definition.targets
    ]
    return {
        "kind": "guided_material_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": direction,
            "operationOrdinal": ordinal,
            "operationId": MATERIAL_PALETTE_OPERATION_IDS[ordinal - 1],
            "mutating": ordinal in MATERIAL_PALETTE_MUTATING_ORDINALS,
            "receiptId": receipt.receipt_id,
            "stepId": receipt.step_id,
            "actionName": receipt.action_name,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(completed),
                "preconditionsValidated": ordinal == 1,
                "completeMaterialPalette": ordinal
                == len(MATERIAL_PALETTE_OPERATION_IDS),
                "stage": min(stage, len(MATERIAL_PALETTE_OPERATION_IDS)),
                "materialIds": [
                    definition.logical_id for definition in definitions
                ],
                "targetIds": target_ids,
                "paletteEntryCount": len(definitions),
                "paletteValidated": stage >= 3,
                "materialsCreated": stage >= 4,
                "surfacesConfigured": stage >= 4,
                "assignmentsApplied": stage >= 4,
                "resolvedMaterialNames": (
                    [definition.name for definition in definitions]
                    if stage >= 4
                    else []
                ),
                "rnaMaterialPaletteMutations": list(rna_mutations),
            },
        },
    }


def resume_material_palette_transaction(
    *,
    receipt: Any,
    completed_operations: tuple[int, ...],
    fingerprint: str,
    definition: tuple[Any, ...],
) -> GuidedGeometryTransaction:
    if not completed_operations or completed_operations != tuple(
        range(1, len(completed_operations) + 1)
    ):
        raise ValueError("completed_operations must be a non-empty ordinal prefix")
    if receipt is None or not isinstance(fingerprint, str) or len(fingerprint) != 64:
        raise ValueError(
            "A resumed material palette transaction requires its receipt and fingerprint"
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
    definitions: tuple[Any, ...],
    deps: Any,
) -> None:
    if (
        transaction.completed_operations != completed_operations
        or transaction.definition_fingerprint
        != _definition_fingerprint(definitions)
        or transaction.receipt.receipt_id != receipt_id
        or transaction.receipt.step_id != step_id
        or transaction.receipt.action_name != action_name
    ):
        raise RuntimeError("Guided material palette transaction binding changed")
    _validate_stage(
        receipts,
        transaction.receipt,
        definitions,
        completed_operations,
        deps,
    )
    if (
        _fingerprint(receipts, definitions, transaction.receipt, deps)
        != transaction.fingerprint
    ):
        raise RuntimeError("Guided material palette transaction fingerprint changed")


def verify_material_palette_stage(
    *,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: tuple[Any, ...],
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
    receipt_required = 4 in completed_operations
    if receipt_required:
        if rebound_partial is None:
            raise RuntimeError("Material palette receipt is unavailable")
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
            raise RuntimeError("Material palette pre-mutation stage contains a receipt")
        target_groups = _owned_targets(rebound_receipts, definition, deps)
        receipt = _empty_receipt(
            receipt_id,
            step_id,
            action_name,
            target_groups[0][0][0],
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
            raise RuntimeError("Material palette stage fingerprint changed")
    return True


def execute_material_palette_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: tuple[Any, ...],
    transaction: GuidedGeometryTransaction | None = None,
) -> GuidedGeometryOperationResult:
    if action_name != MATERIAL_PALETTE_ACTION:
        raise ValueError(f"Unsupported guided material palette action: {action_name}")
    if not 1 <= operation_ordinal <= len(MATERIAL_PALETTE_OPERATION_IDS):
        raise ValueError("operation_ordinal must be in [1, 4]")
    deps = _dependencies()
    expected_completed = tuple(range(1, operation_ordinal))
    if transaction is None:
        if operation_ordinal != 1:
            raise RuntimeError(
                "Guided material palette operation 01 must start the transaction"
            )
        target_groups = _owned_targets(receipts, definition, deps)
        receipt = _empty_receipt(
            receipt_id,
            step_id,
            action_name,
            target_groups[0][0][0],
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
            _validate_base_state(receipts, definition, deps)
        elif operation_ordinal == 4:
            receipt, rna_mutations = _create_and_assign_palette(
                receipt,
                receipts,
                definition,
                deps,
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
            if operation_ordinal == 4 and receipt.created:
                receipt = _remove_palette(receipt, definition, deps)
            if _fingerprint(receipts, definition, receipt, deps) != before:
                raise RuntimeError("Material palette compensation fingerprint changed")
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                "Guided material palette forward operation 04 failed and rollback failed"
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
            definitions=definition,
            completed=completed,
            rna_mutations=rna_mutations,
        ),
        before,
        after,
    )


def inverse_material_palette_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: tuple[Any, ...],
    transaction: GuidedGeometryTransaction,
) -> GuidedGeometryOperationResult:
    if action_name != MATERIAL_PALETTE_ACTION:
        raise ValueError(f"Unsupported guided material palette action: {action_name}")
    if (
        not transaction.completed_operations
        or transaction.completed_operations[-1] != operation_ordinal
    ):
        raise RuntimeError(
            "Guided material palette inverse must target the latest operation"
        )
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
        receipt = _remove_palette(receipt, definition, deps)
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
            definitions=definition,
            completed=completed,
        ),
        before,
        after,
    )


__all__ = (
    "MATERIAL_PALETTE_ACTION",
    "MATERIAL_PALETTE_MUTATING_ORDINALS",
    "MATERIAL_PALETTE_OPERATION_IDS",
    "execute_material_palette_operation",
    "inverse_material_palette_operation",
    "resume_material_palette_transaction",
    "verify_material_palette_stage",
)
