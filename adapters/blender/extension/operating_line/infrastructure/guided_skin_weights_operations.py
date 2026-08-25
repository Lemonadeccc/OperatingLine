"""Operation-level execution for the bounded explicit Skin Weights guide leaf."""

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


SKIN_WEIGHTS_ACTION = "blender.rig.bind_skin_weights"
SKIN_WEIGHTS_OPERATION_IDS = (
    "workspace.layout",
    "panel.object_data",
    "mode.weight_paint",
    "semantic.normalized_weights",
    "projection.semantic.skin_weights.weights",
    "semantic.armature_modifier",
    "projection.semantic.skin_weights.preserve_volume",
    "projection.semantic.skin_weights.modifier_name",
    "semantic.verify_skin_weights",
)
SKIN_WEIGHTS_MUTATING_ORDINALS = frozenset({5, 7, 8})
_SKIN_WEIGHTS_EXECUTE_TOOL = "operatingline.blender.rig.skin-weights.execute-next"


def _dependencies() -> SimpleNamespace:
    from ..application.session import ModifierState, MutationRecord, SkinWeightsState
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
        skin_weights_state_matches,
        snapshot_modifier,
        snapshot_skin_weights,
    )

    return SimpleNamespace(
        ModifierState=ModifierState,
        MutationRecord=MutationRecord,
        SkinWeightsState=SkinWeightsState,
        build_resource_registry=build_resource_registry,
        ensure_modifier_id_available=ensure_modifier_id_available,
        ensure_receipts_intact=ensure_receipts_intact,
        find_owned_modifier=find_owned_modifier,
        make_receipt=make_receipt,
        mesh_content_signature=mesh_content_signature,
        owned_resource=owned_resource,
        rebind_receipts_after_native_restore=rebind_receipts_after_native_restore,
        resolve_resource=resolve_resource,
        rollback_partial=rollback_partial,
        rollback_receipt=rollback_receipt,
        skin_weights_state_matches=skin_weights_state_matches,
        snapshot_modifier=snapshot_modifier,
        snapshot_skin_weights=snapshot_skin_weights,
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
            definition.armature_id,
            definition.modifier_id,
            definition.modifier_name,
            bool(definition.preserve_volume),
            tuple(
                (
                    item.vertex_index,
                    tuple(
                        (influence.bone_name, influence.weight)
                        for influence in item.influences
                    ),
                )
                for item in definition.weights
            ),
        )
    )


def _pending_modifier_name(receipt_id: str) -> str:
    return f"OperatingLine.PendingSkinModifier.{receipt_id[:8]}"


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


def _bone_names(definition: Any) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            influence.bone_name
            for item in definition.weights
            for influence in item.influences
        )
    )


def _owned_resources(
    receipts: Mapping[str, Any], definition: Any, deps: Any
) -> tuple[Any, Any, Any, Any, Any, Any, Any, Any]:
    registry = deps.build_resource_registry(receipts)
    target_identity, target = deps.owned_resource(
        registry, definition.target_id, "OBJECT"
    )
    if getattr(target, "type", None) != "MESH":
        raise ValueError(f"Skin target is not an owned mesh: {definition.target_id}")
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
            f"Owned skin mesh data is unavailable: {definition.target_id}"
        )
    armature_identity, armature = deps.owned_resource(
        registry, definition.armature_id, "OBJECT"
    )
    if getattr(armature, "type", None) != "ARMATURE":
        raise ValueError(
            f"Skin armature is not an owned armature: {definition.armature_id}"
        )
    armature_data_identity, armature_data = deps.owned_resource(
        registry, f"{definition.armature_id}.data", "ARMATURE"
    )
    if armature.data is not armature_data:
        raise RuntimeError("Skin armature data identity is inconsistent")
    return (
        target_identity,
        target,
        mesh_identity,
        target.data,
        armature_identity,
        armature,
        armature_data_identity,
        armature_data,
    )


def _validate_definition_against_resources(
    target: Any,
    armature_data: Any,
    definition: Any,
    *,
    groups_must_be_absent: bool,
) -> tuple[str, ...]:
    vertex_count = len(target.data.vertices)
    if vertex_count > 8192:
        raise RuntimeError("Skin target exceeds the 8192 vertex limit")
    if {item.vertex_index for item in definition.weights} != set(range(vertex_count)):
        raise ValueError("Skin weights must cover every target vertex exactly once")
    bone_names = _bone_names(definition)
    for bone_name in bone_names:
        if armature_data.bones.get(bone_name) is None:
            raise ValueError(f"Skin weights reference unknown bone: {bone_name}")
        if groups_must_be_absent and target.vertex_groups.get(bone_name) is not None:
            raise RuntimeError(f"Cannot replace existing vertex group: {bone_name}")
    return bone_names


def _ensure_modifier_name_available(target: Any, name: str) -> None:
    if target.modifiers.get(name) is not None:
        raise RuntimeError(f"Cannot replace existing modifier: {name}")


def _validate_base_state(
    receipts: Mapping[str, Any], definition: Any, receipt_id: str, deps: Any
) -> tuple[Any, Any, Any, Any, Any, Any, Any, Any]:
    deps.ensure_receipts_intact(receipts)
    resources = _owned_resources(receipts, definition, deps)
    (
        _target_identity,
        target,
        _mesh_identity,
        _mesh,
        _armature_identity,
        _armature,
        _armature_data_identity,
        armature_data,
    ) = resources
    if target.parent is not None:
        raise RuntimeError("Skin target must be unparented")
    if any(modifier.type == "ARMATURE" for modifier in target.modifiers):
        raise RuntimeError("Skin target already has an Armature modifier")
    deps.ensure_modifier_id_available(receipts, definition.modifier_id)
    _ensure_modifier_name_available(target, definition.modifier_name)
    _ensure_modifier_name_available(target, _pending_modifier_name(receipt_id))
    _validate_definition_against_resources(
        target,
        armature_data,
        definition,
        groups_must_be_absent=True,
    )
    return resources


def _vertex_group_assignments(
    target: Any, group_index: int
) -> tuple[tuple[int, float], ...]:
    assignments = []
    for vertex in target.data.vertices:
        membership = next(
            (item for item in vertex.groups if item.group == group_index),
            None,
        )
        if membership is not None:
            assignments.append((int(vertex.index), float(membership.weight)))
    return tuple(assignments)


def _vertex_group_signature(target: Any) -> tuple[Any, ...]:
    return tuple(
        (
            group.name,
            int(group.index),
            bool(group.lock_weight),
            _vertex_group_assignments(target, group.index),
        )
        for group in target.vertex_groups
    )


def _modifier_signature(target: Any, armature: Any) -> tuple[Any, ...]:
    return tuple(
        (
            modifier.name,
            modifier.type,
            (
                "accepted-armature"
                if modifier.type == "ARMATURE" and modifier.object is armature
                else (
                    None
                    if getattr(modifier, "object", None) is None
                    else f"external:{modifier.object.name}"
                )
            ),
            (
                bool(modifier.use_vertex_groups),
                bool(modifier.use_bone_envelopes),
                bool(modifier.use_deform_preserve_volume),
            )
            if modifier.type == "ARMATURE"
            else None,
        )
        for modifier in target.modifiers
    )


def _fingerprint(
    receipts: Mapping[str, Any], definition: Any, deps: Any
) -> str:
    _bpy().context.view_layer.update()
    (
        _target_identity,
        target,
        _mesh_identity,
        mesh,
        _armature_identity,
        armature,
        _armature_data_identity,
        armature_data,
    ) = _owned_resources(receipts, definition, deps)
    return _digest(
        (
            (target.name, target.type, mesh.name),
            deps.mesh_content_signature(mesh),
            _vertex_group_signature(target),
            (armature.name, armature.type, armature_data.name),
            tuple(
                (bone.name, bool(bone.use_deform))
                for bone in armature_data.bones
            ),
            _modifier_signature(target, armature),
        )
    )


def _skin_mutation(receipt: Any, definition: Any, deps: Any) -> Any:
    matches = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.attribute == f"skin_weights:{definition.modifier_id}"
        and isinstance(mutation.after, deps.SkinWeightsState)
    )
    if len(matches) != 1:
        raise RuntimeError("Partial Skin Weights receipt must contain one weight state")
    return matches[0]


def _modifier_mutation(receipt: Any, definition: Any, deps: Any) -> Any:
    matches = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.attribute == f"modifier:{definition.modifier_id}"
        and isinstance(mutation.after, deps.ModifierState)
    )
    if len(matches) != 1:
        raise RuntimeError("Partial Skin Weights receipt must contain one modifier state")
    return matches[0]


def _mesh_mutation(receipt: Any) -> Any:
    matches = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.attribute == "mesh_content"
    )
    if len(matches) != 1:
        raise RuntimeError("Partial Skin Weights receipt must contain one mesh guard")
    return matches[0]


def _modifier_from_mutation(receipt: Any, definition: Any, deps: Any) -> tuple[Any, Any]:
    mutation = _modifier_mutation(receipt, definition, deps)
    target = deps.resolve_resource(mutation.resource)
    state = mutation.after
    if target is None or not 0 <= state.stack_index < len(target.modifiers):
        raise RuntimeError("Partial Skin Weights modifier is unavailable")
    modifier = target.modifiers[state.stack_index]
    if modifier.as_pointer() != state.pointer or modifier.type != "ARMATURE":
        raise RuntimeError("Partial Skin Weights modifier binding changed")
    return mutation, modifier


def _weights_match_definition(target: Any, state: Any, definition: Any) -> bool:
    expected_names = _bone_names(definition)
    if tuple(group.display_name for group in state.groups) != expected_names:
        return False
    expected_by_name: dict[str, list[tuple[int, float]]] = {
        name: [] for name in expected_names
    }
    for item in definition.weights:
        for influence in item.influences:
            expected_by_name[influence.bone_name].append(
                (item.vertex_index, influence.weight)
            )
    for group_state in state.groups:
        actual = _vertex_group_assignments(
            target, target.vertex_groups[group_state.stack_index].index
        )
        expected = tuple(expected_by_name[group_state.display_name])
        if len(actual) != len(expected):
            return False
        for (actual_index, actual_weight), (expected_index, expected_weight) in zip(
            actual, expected, strict=True
        ):
            if actual_index != expected_index or not math.isclose(
                actual_weight,
                expected_weight,
                rel_tol=1e-6,
                abs_tol=1e-6,
            ):
                return False
    return True


def _validate_stage(
    receipts: Mapping[str, Any],
    receipt: Any,
    definition: Any,
    completed_operations: tuple[int, ...],
    deps: Any,
) -> tuple[Any, Any, Any, Any]:
    stage = completed_operations[-1] if completed_operations else 0
    resources = _owned_resources(receipts, definition, deps)
    (
        target_identity,
        target,
        mesh_identity,
        mesh,
        armature_identity,
        armature,
        armature_data_identity,
        armature_data,
    ) = resources
    if receipt.anchor != target_identity or receipt.created or receipt.artifacts:
        raise RuntimeError("Partial Skin Weights receipt binding changed")
    if stage < 5:
        _validate_base_state(receipts, definition, receipt.receipt_id, deps)
        if receipt.mutations:
            raise RuntimeError("Skin Weights pre-mutation receipt changed")
        return target, armature, mesh, armature_data

    combined_receipts = dict(receipts)
    combined_receipts["__guided_skin_weights_partial__"] = receipt
    deps.ensure_receipts_intact(combined_receipts)
    if target.parent is not None:
        raise RuntimeError("Skin target parent changed")
    bone_names = _validate_definition_against_resources(
        target,
        armature_data,
        definition,
        groups_must_be_absent=False,
    )
    deform_mutations = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.attribute.startswith("armature_bone_use_deform:")
    )
    if (
        len(deform_mutations) != len(bone_names)
        or tuple(
            mutation.attribute.partition(":")[2]
            for mutation in deform_mutations
        )
        != bone_names
    ):
        raise RuntimeError("Partial Skin Weights bone-deform receipt changed")
    for mutation, bone_name in zip(deform_mutations, bone_names, strict=True):
        bone = armature_data.bones.get(bone_name)
        if (
            mutation.resource != armature_data_identity
            or not isinstance(mutation.before, bool)
            or mutation.after is not True
            or bone is None
            or bone.use_deform is not True
        ):
            raise RuntimeError(f"Partial Skin Weights bone state changed: {bone_name}")

    skin_mutation = _skin_mutation(receipt, definition, deps)
    skin_state = skin_mutation.after
    mesh_mutation = _mesh_mutation(receipt)
    if (
        skin_mutation.resource != target_identity
        or skin_mutation.before is not None
        or skin_state.logical_id != definition.modifier_id
        or skin_state.receipt_token != receipt.receipt_id
        or skin_state.step_id != receipt.step_id
        or skin_state.action_name != receipt.action_name
        or not deps.skin_weights_state_matches(target, skin_state)
        or not _weights_match_definition(target, skin_state, definition)
        or mesh_mutation.resource != mesh_identity
        or mesh_mutation.after != deps.mesh_content_signature(mesh)
    ):
        raise RuntimeError("Partial Skin Weights assignment state changed")

    expected_mutation_count = len(bone_names) + 2 + (1 if stage >= 7 else 0)
    if len(receipt.mutations) != expected_mutation_count:
        raise RuntimeError("Partial Skin Weights receipt mutation set changed")
    armature_modifiers = tuple(
        modifier for modifier in target.modifiers if modifier.type == "ARMATURE"
    )
    if stage < 7:
        if armature_modifiers:
            raise RuntimeError("Partial Skin Weights contains a premature modifier")
    else:
        mutation = _modifier_mutation(receipt, definition, deps)
        owned = deps.find_owned_modifier(
            {"guided-partial": receipt}, definition.modifier_id
        )
        expected_name = (
            _pending_modifier_name(receipt.receipt_id)
            if stage < 8
            else definition.modifier_name
        )
        modifier = armature_modifiers[0] if len(armature_modifiers) == 1 else None
        checks = {
            "count": modifier is not None,
            "owned": owned is not None,
            "owner": owned is not None and owned[0] is target,
            "instance": owned is not None
            and modifier is not None
            and owned[1].as_pointer() == modifier.as_pointer(),
            "resource": mutation.resource == target_identity,
            "before": mutation.before is None,
            "state_name": mutation.after.display_name == expected_name,
            "name": modifier is not None and modifier.name == expected_name,
            "armature": modifier is not None and modifier.object is armature,
            "vertex_groups": modifier is not None
            and bool(modifier.use_vertex_groups),
            "bone_envelopes": modifier is not None
            and not bool(modifier.use_bone_envelopes),
            "preserve_volume": modifier is not None
            and bool(modifier.use_deform_preserve_volume)
            is definition.preserve_volume,
            "logical_armature": any(
                name == "object" and value == armature_identity
                for name, value in mutation.after.properties
            ),
        }
        failed = tuple(name for name, passed in checks.items() if not passed)
        if failed:
            raise RuntimeError(
                "Partial Skin Weights modifier state changed: "
                + ", ".join(failed)
            )
    return target, armature, mesh, armature_data


def _apply_weights(
    receipt: Any,
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    (
        target_identity,
        target,
        mesh_identity,
        mesh,
        _armature_identity,
        _armature,
        armature_data_identity,
        armature_data,
    ) = _validate_base_state(receipts, definition, receipt.receipt_id, deps)
    bone_names = _bone_names(definition)
    before_mesh = deps.mesh_content_signature(mesh)
    mutations: list[Any] = []
    created_groups: list[Any] = []
    rna_mutations: list[dict[str, Any]] = []
    skin_state_recorded = False
    try:
        for bone_order, bone_name in enumerate(bone_names, start=1):
            bone = armature_data.bones[bone_name]
            before = bool(bone.use_deform)
            bone.use_deform = True
            if bone.use_deform is not True:
                raise RuntimeError(f"Blender did not enable deform for {bone_name}")
            mutations.append(
                deps.MutationRecord(
                    armature_data_identity,
                    f"armature_bone_use_deform:{bone_name}",
                    before,
                    True,
                )
            )
            rna_mutations.append(
                {
                    "order": len(rna_mutations) + 1,
                    "boneOrder": bone_order,
                    "executionMethod": "blender_rna_armature_bone_deform_write",
                    "mcpTool": _SKIN_WEIGHTS_EXECUTE_TOOL,
                    "sourceOperationId": SKIN_WEIGHTS_OPERATION_IDS[4],
                    "semanticAction": SKIN_WEIGHTS_OPERATION_IDS[4],
                    "valueSource": "accepted_action_argument",
                    "actionArgument": "weights",
                    "mutationKind": "armature_bone_deform_enable",
                    "targetId": definition.target_id,
                    "armatureId": definition.armature_id,
                    "boneName": bone_name,
                    "acceptedValue": True,
                    "observedValue": bool(bone.use_deform),
                    "uiPath": [
                        "Object Data Properties",
                        definition.armature_id,
                        "Bones",
                        bone_name,
                        "Deform",
                    ],
                }
            )
        groups = {}
        for group_order, bone_name in enumerate(bone_names, start=1):
            group = target.vertex_groups.new(name=bone_name)
            if group.name != bone_name or group.bl_rna.identifier != "VertexGroup":
                raise RuntimeError(f"Vertex Group creation changed: {bone_name}")
            created_groups.append(group)
            groups[bone_name] = group
            rna_mutations.append(
                {
                    "order": len(rna_mutations) + 1,
                    "groupOrder": group_order,
                    "executionMethod": "blender_rna_vertex_group_create",
                    "mcpTool": _SKIN_WEIGHTS_EXECUTE_TOOL,
                    "sourceOperationId": SKIN_WEIGHTS_OPERATION_IDS[4],
                    "semanticAction": SKIN_WEIGHTS_OPERATION_IDS[4],
                    "valueSource": "accepted_action_argument",
                    "actionArgument": "weights",
                    "mutationKind": "vertex_group_create",
                    "targetId": definition.target_id,
                    "armatureId": definition.armature_id,
                    "boneName": bone_name,
                    "groupName": group.name,
                    "resourceType": group.bl_rna.identifier,
                    "observedResource": True,
                    "uiPath": [
                        "Object Data Properties",
                        definition.target_id,
                        "Vertex Groups",
                        group.name,
                    ],
                }
            )
        for vertex_order, item in enumerate(definition.weights, start=1):
            for influence_order, influence in enumerate(item.influences, start=1):
                groups[influence.bone_name].add(
                    (item.vertex_index,), influence.weight, "REPLACE"
                )
                membership = next(
                    (
                        membership
                        for membership in target.data.vertices[
                            item.vertex_index
                        ].groups
                        if membership.group == groups[influence.bone_name].index
                    ),
                    None,
                )
                if membership is None or not math.isclose(
                    float(membership.weight),
                    float(influence.weight),
                    rel_tol=1e-6,
                    abs_tol=1e-6,
                ):
                    raise RuntimeError(
                        "Vertex weight assignment changed: "
                        f"{item.vertex_index}/{influence.bone_name}"
                    )
                rna_mutations.append(
                    {
                        "order": len(rna_mutations) + 1,
                        "vertexOrder": vertex_order,
                        "influenceOrder": influence_order,
                        "executionMethod": "blender_rna_vertex_group_weight_replace",
                        "mcpTool": _SKIN_WEIGHTS_EXECUTE_TOOL,
                        "sourceOperationId": SKIN_WEIGHTS_OPERATION_IDS[4],
                        "semanticAction": SKIN_WEIGHTS_OPERATION_IDS[4],
                        "valueSource": "accepted_action_argument",
                        "actionArgument": "weights",
                        "mutationKind": "vertex_group_weight_replace",
                        "targetId": definition.target_id,
                        "armatureId": definition.armature_id,
                        "vertexIndex": int(item.vertex_index),
                        "boneName": influence.bone_name,
                        "groupName": groups[influence.bone_name].name,
                        "assignmentMode": "REPLACE",
                        "acceptedWeight": float(influence.weight),
                        "observedWeight": float(membership.weight),
                        "observedMembership": True,
                        "uiPath": [
                            "Weight Paint",
                            definition.target_id,
                            "Vertex",
                            str(item.vertex_index),
                            groups[influence.bone_name].name,
                            "Weight",
                        ],
                    }
                )
        skin_state = deps.snapshot_skin_weights(
            target,
            created_groups,
            definition.modifier_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
        )
        mutations.append(
            deps.MutationRecord(
                target_identity,
                f"skin_weights:{definition.modifier_id}",
                None,
                skin_state,
            )
        )
        skin_state_recorded = True
        mutations.append(
            deps.MutationRecord(
                mesh_identity,
                "mesh_content",
                before_mesh,
                deps.mesh_content_signature(mesh),
            )
        )
        return replace(receipt, mutations=tuple(mutations)), tuple(rna_mutations)
    except Exception:
        if not skin_state_recorded:
            for group in reversed(created_groups):
                current = target.vertex_groups.get(group.name)
                if current is not None:
                    target.vertex_groups.remove(current)
        deps.rollback_partial(
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            [],
            mutations,
            [],
        )
        raise


def _remove_weights(receipt: Any, deps: Any) -> Any:
    modifier_mutations = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.attribute.startswith("modifier:")
    )
    if modifier_mutations:
        raise RuntimeError("Skin Weights modifier must be removed before its weights")
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
    return replace(receipt, mutations=())


def _create_modifier_for_receipt(
    receipt: Any,
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    (
        target_identity,
        target,
        _mesh_identity,
        _mesh,
        armature_identity,
        armature,
        _armature_data_identity,
        _armature_data,
    ) = _owned_resources(receipts, definition, deps)
    if any(modifier.type == "ARMATURE" for modifier in target.modifiers):
        raise RuntimeError("Skin target already has an Armature modifier")
    deps.ensure_modifier_id_available(receipts, definition.modifier_id)
    pending_name = _pending_modifier_name(receipt.receipt_id)
    _ensure_modifier_name_available(target, pending_name)
    _ensure_modifier_name_available(target, definition.modifier_name)
    modifier = None
    mutation = None
    try:
        modifier = target.modifiers.new(pending_name, "ARMATURE")
        modifier.object = armature
        modifier.use_vertex_groups = True
        modifier.use_bone_envelopes = False
        modifier.use_deform_preserve_volume = definition.preserve_volume
        state = deps.snapshot_modifier(
            target,
            modifier,
            definition.modifier_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            {"object": armature_identity},
        )
        mutation = deps.MutationRecord(
            target_identity,
            f"modifier:{definition.modifier_id}",
            None,
            state,
        )
        if (
            modifier.bl_rna.identifier != "ArmatureModifier"
            or modifier.name != pending_name
            or modifier.object is not armature
            or modifier.use_vertex_groups is not True
            or modifier.use_bone_envelopes is not False
            or bool(modifier.use_deform_preserve_volume)
            is not definition.preserve_volume
        ):
            raise RuntimeError("Armature Modifier RNA readback changed")
        rna_mutations = (
            {
                "order": 1,
                "executionMethod": "blender_rna_armature_modifier_create",
                "mcpTool": _SKIN_WEIGHTS_EXECUTE_TOOL,
                "sourceOperationId": SKIN_WEIGHTS_OPERATION_IDS[6],
                "semanticAction": SKIN_WEIGHTS_OPERATION_IDS[6],
                "valueSource": "managed_receipt_identity",
                "mutationKind": "armature_modifier_create",
                "targetId": definition.target_id,
                "armatureId": definition.armature_id,
                "modifierId": definition.modifier_id,
                "pendingModifierName": modifier.name,
                "resourceType": modifier.bl_rna.identifier,
                "modifierType": modifier.type,
                "observedResource": True,
                "uiPath": [
                    "Properties",
                    definition.target_id,
                    "Modifiers",
                    modifier.name,
                ],
            },
            {
                "order": 2,
                "executionMethod": "blender_rna_armature_modifier_object_bind",
                "mcpTool": _SKIN_WEIGHTS_EXECUTE_TOOL,
                "sourceOperationId": SKIN_WEIGHTS_OPERATION_IDS[6],
                "semanticAction": SKIN_WEIGHTS_OPERATION_IDS[6],
                "valueSource": "accepted_action_argument",
                "actionArgument": "armatureId",
                "mutationKind": "armature_modifier_object_bind",
                "targetId": definition.target_id,
                "armatureId": definition.armature_id,
                "modifierId": definition.modifier_id,
                "pendingModifierName": modifier.name,
                "observedBinding": True,
                "uiPath": [
                    "Properties",
                    definition.target_id,
                    "Modifiers",
                    modifier.name,
                    "Object",
                    definition.armature_id,
                ],
            },
            *tuple(
                {
                    "order": order,
                    "executionMethod": "blender_rna_armature_modifier_property_write",
                    "mcpTool": _SKIN_WEIGHTS_EXECUTE_TOOL,
                    "sourceOperationId": SKIN_WEIGHTS_OPERATION_IDS[6],
                    "semanticAction": SKIN_WEIGHTS_OPERATION_IDS[6],
                    "valueSource": value_source,
                    "actionArgument": action_argument,
                    "mutationKind": "armature_modifier_property_write",
                    "targetId": definition.target_id,
                    "armatureId": definition.armature_id,
                    "modifierId": definition.modifier_id,
                    "pendingModifierName": modifier.name,
                    "propertyName": property_name,
                    "acceptedValue": bool(accepted_value),
                    "observedValue": bool(observed_value),
                    "uiPath": [
                        "Properties",
                        definition.target_id,
                        "Modifiers",
                        modifier.name,
                        ui_label,
                    ],
                }
                for order, (
                    property_name,
                    accepted_value,
                    observed_value,
                    value_source,
                    action_argument,
                    ui_label,
                ) in enumerate(
                    (
                        (
                            "use_vertex_groups",
                            True,
                            modifier.use_vertex_groups,
                            "catalog_constant",
                            None,
                            "Vertex Groups",
                        ),
                        (
                            "use_bone_envelopes",
                            False,
                            modifier.use_bone_envelopes,
                            "catalog_constant",
                            None,
                            "Bone Envelopes",
                        ),
                        (
                            "use_deform_preserve_volume",
                            definition.preserve_volume,
                            modifier.use_deform_preserve_volume,
                            "accepted_action_argument",
                            "preserveVolume",
                            "Preserve Volume",
                        ),
                    ),
                    start=3,
                )
            ),
        )
        return (
            replace(receipt, mutations=(*receipt.mutations, mutation)),
            rna_mutations,
        )
    except Exception:
        if modifier is not None and mutation is None:
            target.modifiers.remove(modifier)
        if mutation is not None:
            deps.rollback_partial(
                receipt.receipt_id,
                receipt.step_id,
                receipt.action_name,
                [],
                [mutation],
                [],
            )
        raise


def _remove_modifier(receipt: Any, definition: Any, deps: Any) -> Any:
    mutation = _modifier_mutation(receipt, definition, deps)
    mini_receipt = deps.make_receipt(
        receipt.receipt_id,
        receipt.step_id,
        receipt.action_name,
        [],
        [mutation],
        [],
        receipt.anchor,
    )
    deps.rollback_receipt(mini_receipt)
    return replace(
        receipt,
        mutations=tuple(item for item in receipt.mutations if item is not mutation),
    )


def _rename_modifier(
    receipt: Any,
    definition: Any,
    name: str,
    deps: Any,
) -> Any:
    mutation, modifier = _modifier_from_mutation(receipt, definition, deps)
    target = deps.resolve_resource(mutation.resource)
    if target is None:
        raise RuntimeError("Partial Skin Weights modifier owner is unavailable")
    existing = target.modifiers.get(name)
    if existing is not None and existing is not modifier:
        raise RuntimeError(f"Cannot replace existing modifier: {name}")
    prior_name = modifier.name
    try:
        modifier.name = name
        if modifier.name != name:
            raise RuntimeError(f"Blender did not apply modifier name: {name}")
        updated_state = deps.snapshot_modifier(
            target,
            modifier,
            definition.modifier_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            {"object": next(
                value
                for key, value in mutation.after.properties
                if key == "object"
            )},
        )
        updated = replace(mutation, after=updated_state)
        return replace(
            receipt,
            mutations=tuple(
                updated if item is mutation else item for item in receipt.mutations
            ),
        )
    except Exception:
        modifier.name = prior_name
        if modifier.name != prior_name:
            raise GuidedGeometryAtomicityError(
                "Skin Weights modifier rename failed and prior name was not restored"
            )
        raise


def _modifier_name_mutation(
    receipt: Any, definition: Any, deps: Any
) -> tuple[dict[str, Any], ...]:
    _mutation, modifier = _modifier_from_mutation(receipt, definition, deps)
    if modifier.name != definition.modifier_name:
        raise RuntimeError("Armature Modifier name write was not observed")
    return (
        {
            "order": 1,
            "executionMethod": "blender_rna_modifier_name_write",
            "mcpTool": _SKIN_WEIGHTS_EXECUTE_TOOL,
            "sourceOperationId": SKIN_WEIGHTS_OPERATION_IDS[7],
            "semanticAction": SKIN_WEIGHTS_OPERATION_IDS[7],
            "valueSource": "accepted_action_argument",
            "actionArgument": "modifierName",
            "mutationKind": "armature_modifier_name_write",
            "targetId": definition.target_id,
            "armatureId": definition.armature_id,
            "modifierId": definition.modifier_id,
            "beforeName": _pending_modifier_name(receipt.receipt_id),
            "acceptedName": definition.modifier_name,
            "observedName": modifier.name,
            "uiPath": [
                "Properties",
                definition.target_id,
                "Modifiers",
                modifier.name,
                "Name",
            ],
        },
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
    rna_skin_weight_mutations: tuple[dict[str, Any], ...] = (),
    rna_skin_modifier_mutations: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    stage = completed[-1] if completed else 0
    bone_count = len(_bone_names(definition)) if stage >= 5 else 0
    return {
        "kind": "guided_skin_weights_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": direction,
            "operationOrdinal": ordinal,
            "operationId": SKIN_WEIGHTS_OPERATION_IDS[ordinal - 1],
            "mutating": ordinal in SKIN_WEIGHTS_MUTATING_ORDINALS,
            "receiptId": receipt.receipt_id,
            "stepId": receipt.step_id,
            "actionName": receipt.action_name,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(completed),
                "preconditionsValidated": ordinal == 1,
                "completeSkinWeights": ordinal == len(SKIN_WEIGHTS_OPERATION_IDS),
                "stage": min(stage, 8),
                "targetId": definition.target_id,
                "armatureId": definition.armature_id,
                "modifierId": definition.modifier_id,
                "vertexCount": len(definition.weights) if stage >= 5 else 0,
                "boneCount": bone_count,
                "groupCount": bone_count,
                "weightsApplied": stage >= 5,
                "modifierCreated": stage >= 7,
                "preserveVolumeApplied": stage >= 7,
                "modifierNameApplied": stage >= 8,
                "resolvedModifierName": (
                    definition.modifier_name if stage >= 8 else None
                ),
                "rnaSkinWeightMutations": list(rna_skin_weight_mutations),
                "rnaSkinModifierMutations": list(rna_skin_modifier_mutations),
            },
        },
    }


def resume_skin_weights_transaction(
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
            "A resumed Skin Weights transaction requires its receipt and fingerprint"
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
) -> tuple[Any, Any, Any, Any]:
    if (
        transaction.completed_operations != completed_operations
        or transaction.definition_fingerprint != _definition_fingerprint(definition)
        or transaction.receipt.receipt_id != receipt_id
        or transaction.receipt.step_id != step_id
        or transaction.receipt.action_name != action_name
    ):
        raise RuntimeError("Guided Skin Weights transaction binding changed")
    resources = _validate_stage(
        receipts,
        transaction.receipt,
        definition,
        completed_operations,
        deps,
    )
    if _fingerprint(receipts, definition, deps) != transaction.fingerprint:
        raise RuntimeError("Guided Skin Weights transaction fingerprint changed")
    return resources


def verify_skin_weights_stage(
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
        ordinal in SKIN_WEIGHTS_MUTATING_ORDINALS
        for ordinal in completed_operations
    )
    if receipt_required:
        if rebound_partial is None:
            raise RuntimeError("Skin Weights partial receipt is unavailable")
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
            raise RuntimeError("Skin Weights pre-mutation stage contains a receipt")
        target_identity = _owned_resources(
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
        if _fingerprint(rebound_receipts, definition, deps) != expected_fingerprint:
            raise RuntimeError("Skin Weights stage fingerprint changed")
    return True


def execute_skin_weights_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction | None = None,
) -> GuidedGeometryOperationResult:
    if action_name != SKIN_WEIGHTS_ACTION:
        raise ValueError(f"Unsupported guided Skin Weights action: {action_name}")
    if not 1 <= operation_ordinal <= len(SKIN_WEIGHTS_OPERATION_IDS):
        raise ValueError("operation_ordinal must be in [1, 9]")
    deps = _dependencies()
    expected_completed = tuple(range(1, operation_ordinal))
    if transaction is None:
        if operation_ordinal != 1:
            raise RuntimeError("Guided Skin Weights operation 01 must start the transaction")
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

    rna_skin_weight_mutations: tuple[dict[str, Any], ...] = ()
    rna_skin_modifier_mutations: tuple[dict[str, Any], ...] = ()
    try:
        if operation_ordinal == 1:
            _validate_base_state(receipts, definition, receipt_id, deps)
        elif operation_ordinal == 5:
            receipt, rna_skin_weight_mutations = _apply_weights(
                receipt, receipts, definition, deps
            )
        elif operation_ordinal == 7:
            receipt, rna_skin_modifier_mutations = _create_modifier_for_receipt(
                receipt, receipts, definition, deps
            )
        elif operation_ordinal == 8:
            receipt = _rename_modifier(
                receipt, definition, definition.modifier_name, deps
            )
            rna_skin_modifier_mutations = _modifier_name_mutation(
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
            if operation_ordinal == 5 and receipt.mutations:
                receipt = _remove_weights(receipt, deps)
            elif operation_ordinal == 7 and any(
                mutation.attribute.startswith("modifier:")
                for mutation in receipt.mutations
            ):
                receipt = _remove_modifier(receipt, definition, deps)
            elif operation_ordinal == 8:
                mutation, modifier = _modifier_from_mutation(
                    receipt, definition, deps
                )
                if modifier.name != _pending_modifier_name(receipt_id):
                    receipt = _rename_modifier(
                        receipt,
                        definition,
                        _pending_modifier_name(receipt_id),
                        deps,
                    )
            _validate_stage(
                receipts, receipt, definition, expected_completed, deps
            )
            if _fingerprint(receipts, definition, deps) != before:
                raise RuntimeError("Skin Weights compensation fingerprint changed")
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                "Guided Skin Weights forward operation "
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
            rna_skin_weight_mutations=rna_skin_weight_mutations,
            rna_skin_modifier_mutations=rna_skin_modifier_mutations,
        ),
        before,
        after,
    )


def inverse_skin_weights_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction,
) -> GuidedGeometryOperationResult:
    if action_name != SKIN_WEIGHTS_ACTION:
        raise ValueError(f"Unsupported guided Skin Weights action: {action_name}")
    if (
        not transaction.completed_operations
        or transaction.completed_operations[-1] != operation_ordinal
    ):
        raise RuntimeError("Guided Skin Weights inverse must target the latest operation")
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
    if operation_ordinal == 8:
        receipt = _rename_modifier(
            receipt,
            definition,
            _pending_modifier_name(receipt_id),
            deps,
        )
    elif operation_ordinal == 7:
        receipt = _remove_modifier(receipt, definition, deps)
    elif operation_ordinal == 5:
        receipt = _remove_weights(receipt, deps)
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
    "SKIN_WEIGHTS_ACTION",
    "SKIN_WEIGHTS_MUTATING_ORDINALS",
    "SKIN_WEIGHTS_OPERATION_IDS",
    "execute_skin_weights_operation",
    "inverse_skin_weights_operation",
    "resume_skin_weights_transaction",
    "verify_skin_weights_stage",
)
