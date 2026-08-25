"""Operation-level execution for the bounded Armature guide leaf."""

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


ARMATURE_ACTION = "blender.rig.create_armature"
ARMATURE_OPERATION_IDS = (
    "workspace.layout",
    "menu.add_armature",
    "projection.semantic.armature.object_name",
    "projection.semantic.armature.data_name",
    "mode.edit_bones",
    "projection.semantic.armature.bones",
    "semantic.rigid_parent",
    "projection.semantic.armature.bindings",
    "semantic.verify_armature",
)
ARMATURE_MUTATING_ORDINALS = frozenset({2, 3, 4, 6, 8})
_ARMATURE_EXECUTE_TOOL = "operatingline.blender.rig.armature.execute-next"


def _dependencies() -> SimpleNamespace:
    from ..application.session import MutationRecord, ResourceIdentity
    from .snowman_actions.common import (
        build_resource_registry,
        ensure_collection_contents_tracked,
        ensure_logical_ids_available,
        ensure_name_available,
        ensure_receipts_intact,
        journal_created_resource,
        make_receipt,
        owned_resource,
        rebind_receipts_after_native_restore,
        resolve_resource,
        rollback_partial,
        rollback_receipt,
    )
    from .snowman_actions.rigging import (
        _create_edit_bones,
        _object_in_view_layer,
        _parent_state,
        _restore_parent_state_locally,
    )

    return SimpleNamespace(
        MutationRecord=MutationRecord,
        ResourceIdentity=ResourceIdentity,
        build_resource_registry=build_resource_registry,
        ensure_collection_contents_tracked=ensure_collection_contents_tracked,
        ensure_logical_ids_available=ensure_logical_ids_available,
        ensure_name_available=ensure_name_available,
        ensure_receipts_intact=ensure_receipts_intact,
        journal_created_resource=journal_created_resource,
        make_receipt=make_receipt,
        owned_resource=owned_resource,
        rebind_receipts_after_native_restore=rebind_receipts_after_native_restore,
        resolve_resource=resolve_resource,
        rollback_partial=rollback_partial,
        rollback_receipt=rollback_receipt,
        create_edit_bones=_create_edit_bones,
        object_in_view_layer=_object_in_view_layer,
        parent_state=_parent_state,
        restore_parent_state_locally=_restore_parent_state_locally,
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
            definition.object_name,
            definition.data_name,
            definition.collection_id,
            tuple(
                (bone.name, tuple(bone.head), tuple(bone.tail), bone.parent_name)
                for bone in definition.bones
            ),
            tuple(
                (binding.target_id, binding.bone_name)
                for binding in definition.bindings
            ),
        )
    )


def _pending_object_name(receipt_id: str) -> str:
    return f"OperatingLine.PendingArmatureObject.{receipt_id[:8]}"


def _pending_data_name(receipt_id: str) -> str:
    return f"OperatingLine.PendingArmatureData.{receipt_id[:8]}"


def _empty_receipt(
    receipt_id: str,
    step_id: str,
    action_name: str,
    collection_identity: Any,
    deps: Any,
) -> Any:
    return deps.make_receipt(
        receipt_id,
        step_id,
        action_name,
        [],
        [],
        [],
        collection_identity,
    )


def _combined_registry(
    receipts: Mapping[str, Any], receipt: Any | None, deps: Any
) -> dict[str, Any]:
    values = list(receipts.values())
    if receipt is not None and receipt.created:
        values.append(receipt)
    return deps.build_resource_registry(values)


def _owned_collection(
    receipts: Mapping[str, Any], definition: Any, deps: Any
) -> tuple[Any, Any]:
    registry = deps.build_resource_registry(receipts)
    return deps.owned_resource(registry, definition.collection_id, "COLLECTION")


def _binding_targets(
    receipts: Mapping[str, Any], definition: Any, deps: Any
) -> tuple[tuple[Any, Any, Any], ...]:
    registry = deps.build_resource_registry(receipts)
    targets = []
    for binding in definition.bindings:
        identity, target = deps.owned_resource(registry, binding.target_id, "OBJECT")
        if getattr(target, "type", None) != "MESH":
            raise ValueError(
                "Armature binding target is not an owned mesh object: "
                f"{binding.target_id}"
            )
        targets.append((binding, identity, target))
    return tuple(targets)


def _armature_identities(receipt: Any, definition: Any) -> tuple[Any, Any]:
    data = tuple(
        identity
        for identity in receipt.created
        if identity.resource_type == "ARMATURE"
        and identity.logical_id == f"{definition.logical_id}.data"
    )
    objects = tuple(
        identity
        for identity in receipt.created
        if identity.resource_type == "OBJECT"
        and identity.logical_id == definition.logical_id
    )
    if len(data) != 1 or len(objects) != 1 or len(receipt.created) != 2:
        raise RuntimeError(
            "Partial Armature receipt must own exactly one Object and Armature data"
        )
    return data[0], objects[0]


def _armature_resources(
    receipt: Any, definition: Any, deps: Any
) -> tuple[Any, Any, Any, Any]:
    data_identity, object_identity = _armature_identities(receipt, definition)
    armature_data = deps.resolve_resource(data_identity)
    armature = deps.resolve_resource(object_identity)
    if (
        armature_data is None
        or armature is None
        or getattr(armature, "type", None) != "ARMATURE"
        or armature.data is not armature_data
    ):
        raise RuntimeError("Partial Armature ownership binding changed")
    if receipt.anchor != object_identity:
        raise RuntimeError("Partial Armature receipt anchor changed")
    return data_identity, object_identity, armature_data, armature


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


def _rename_object(receipt: Any, definition: Any, name: str, deps: Any) -> Any:
    _data_identity, old_identity, _data, armature = _armature_resources(
        receipt, definition, deps
    )
    armature.name = name
    new_identity = replace(old_identity, display_name=armature.name)
    return _replace_identity(receipt, old_identity, new_identity, deps)


def _rename_data(receipt: Any, definition: Any, name: str, deps: Any) -> Any:
    old_identity, _object_identity, armature_data, _armature = _armature_resources(
        receipt, definition, deps
    )
    armature_data.name = name
    new_identity = replace(old_identity, display_name=armature_data.name)
    return _replace_identity(receipt, old_identity, new_identity, deps)


def _matrix_rows(value: Any) -> tuple[tuple[float, ...], ...]:
    return tuple(tuple(float(component) for component in row) for row in value)


def _vector_close(actual: Any, expected: Any) -> bool:
    return all(
        math.isclose(float(left), float(right), rel_tol=1e-6, abs_tol=1e-6)
        for left, right in zip(actual, expected, strict=True)
    )


def _matrix_close(actual: Any, expected: Any) -> bool:
    return all(
        _vector_close(actual_row, expected_row)
        for actual_row, expected_row in zip(
            _matrix_rows(actual), _matrix_rows(expected), strict=True
        )
    )


def _bone_signature(armature_data: Any) -> tuple[Any, ...]:
    return tuple(
        (
            bone.name,
            tuple(float(value) for value in bone.head_local),
            tuple(float(value) for value in bone.tail_local),
            bone.parent.name if bone.parent is not None else None,
            bool(bone.use_deform),
        )
        for bone in armature_data.bones
    )


def _bones_match(armature: Any, definition: Any) -> bool:
    actual = tuple(armature.data.bones)
    if len(actual) != len(definition.bones):
        return False
    for bone, expected in zip(actual, definition.bones, strict=True):
        if (
            bone.name != expected.name
            or not _vector_close(bone.head_local, expected.head)
            or not _vector_close(bone.tail_local, expected.tail)
            or (bone.parent.name if bone.parent is not None else None)
            != expected.parent_name
            or bone.use_deform
        ):
            return False
    return tuple(bone.name for bone in armature.pose.bones) == tuple(
        bone.name for bone in definition.bones
    ) and all(bone.rotation_mode == "XYZ" for bone in armature.pose.bones)


def _clear_edit_bones(armature: Any, deps: Any) -> None:
    bpy = _bpy()
    view_layer = bpy.context.view_layer
    previous_active = view_layer.objects.active
    previous_selected = tuple(bpy.context.selected_objects)
    previous_mode = previous_active.mode if previous_active is not None else "OBJECT"
    try:
        if previous_active is not None and previous_active.mode != "OBJECT":
            if bpy.ops.object.mode_set(mode="OBJECT") != {"FINISHED"}:
                raise RuntimeError("Blender could not leave the current edit mode")
        for selected in tuple(bpy.context.selected_objects):
            selected.select_set(False)
        armature.select_set(True)
        view_layer.objects.active = armature
        if bpy.ops.object.mode_set(mode="EDIT") != {"FINISHED"}:
            raise RuntimeError("Blender could not enter armature edit mode")
        for bone in tuple(armature.data.edit_bones):
            armature.data.edit_bones.remove(bone)
        if bpy.ops.object.mode_set(mode="OBJECT") != {"FINISHED"}:
            raise RuntimeError("Blender could not leave armature edit mode")
    finally:
        if armature.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        for selected in tuple(bpy.context.selected_objects):
            selected.select_set(False)
        for selected in previous_selected:
            if deps.object_in_view_layer(selected, view_layer):
                selected.select_set(True)
        if previous_active is not None and deps.object_in_view_layer(
            previous_active, view_layer
        ):
            view_layer.objects.active = previous_active
            if previous_mode != "OBJECT":
                bpy.ops.object.mode_set(mode=previous_mode)
        else:
            view_layer.objects.active = None


def _parent_signature(target: Any, armature: Any | None) -> tuple[Any, ...]:
    parent = target.parent
    parent_name = None
    if parent is not None:
        parent_name = (
            "managed-armature"
            if armature is not None and parent is armature
            else f"external:{parent.name}"
        )
    return (
        parent_name,
        target.parent_type,
        target.parent_bone,
        _matrix_rows(target.matrix_world),
        _matrix_rows(target.matrix_parent_inverse),
        _matrix_rows(target.matrix_basis),
    )


def _fingerprint(
    receipts: Mapping[str, Any],
    receipt: Any | None,
    definition: Any,
    stage: int,
    deps: Any,
) -> str:
    # Newly created objects can expose lazy transform values until the first
    # dependency-graph evaluation. Stabilize those values before every proof.
    _bpy().context.view_layer.update()
    registry = _combined_registry(receipts, receipt, deps)
    _collection_identity, collection = deps.owned_resource(
        registry, definition.collection_id, "COLLECTION"
    )
    armature = None
    armature_state = None
    if stage >= 2:
        _data_identity, _object_identity, armature_data, armature = (
            _armature_resources(receipt, definition, deps)
        )
        armature_state = (
            armature.name,
            armature_data.name,
            bool(armature.show_in_front),
            armature.display_type,
            _bone_signature(armature_data),
        )
    targets = _binding_targets(receipts, definition, deps)
    return _digest(
        (
            collection.name,
            tuple(sorted((obj.name, obj.type) for obj in collection.objects)),
            armature_state,
            tuple(
                (
                    binding.target_id,
                    binding.bone_name,
                    _parent_signature(target, armature),
                )
                for binding, _identity, target in targets
            ),
        )
    )


def _preflight(
    receipts: Mapping[str, Any], definition: Any, receipt_id: str, deps: Any
) -> tuple[Any, Any]:
    deps.ensure_receipts_intact(receipts)
    registry = deps.build_resource_registry(receipts)
    collection_identity, collection = deps.owned_resource(
        registry, definition.collection_id, "COLLECTION"
    )
    deps.ensure_collection_contents_tracked(collection, registry)
    deps.ensure_logical_ids_available(
        registry, (definition.logical_id, f"{definition.logical_id}.data")
    )
    for collection_value, name, label in (
        (_bpy().data.objects, definition.object_name, "object"),
        (_bpy().data.armatures, definition.data_name, "armature data"),
        (_bpy().data.objects, _pending_object_name(receipt_id), "pending object"),
        (_bpy().data.armatures, _pending_data_name(receipt_id), "pending armature data"),
    ):
        deps.ensure_name_available(collection_value, name, label)
    for binding, _identity, target in _binding_targets(receipts, definition, deps):
        if target.parent is not None:
            raise RuntimeError(
                "Armature binding target is already parented: "
                f"{binding.target_id}"
            )
    return collection_identity, collection


def _validate_base_state(
    receipts: Mapping[str, Any], definition: Any, deps: Any
) -> tuple[Any, Any]:
    deps.ensure_receipts_intact(receipts)
    registry = deps.build_resource_registry(receipts)
    collection_identity, collection = deps.owned_resource(
        registry, definition.collection_id, "COLLECTION"
    )
    deps.ensure_collection_contents_tracked(collection, registry)
    deps.ensure_logical_ids_available(
        registry, (definition.logical_id, f"{definition.logical_id}.data")
    )
    for binding, _identity, target in _binding_targets(receipts, definition, deps):
        if target.parent is not None:
            raise RuntimeError(
                "Armature binding target is already parented: "
                f"{binding.target_id}"
            )
    return collection_identity, collection


def _validate_stage(
    receipts: Mapping[str, Any],
    receipt: Any,
    definition: Any,
    completed_operations: tuple[int, ...],
    deps: Any,
) -> tuple[Any, Any, Any | None, Any | None]:
    stage = completed_operations[-1] if completed_operations else 0
    if stage < 2:
        collection_identity, collection = _validate_base_state(
            receipts, definition, deps
        )
        if (
            receipt.created
            or receipt.mutations
            or receipt.anchor != collection_identity
        ):
            raise RuntimeError("Armature pre-mutation receipt changed")
        return collection_identity, collection, None, None

    deps.ensure_receipts_intact(receipts)
    registry = _combined_registry(receipts, receipt, deps)
    collection_identity, collection = deps.owned_resource(
        registry, definition.collection_id, "COLLECTION"
    )
    deps.ensure_collection_contents_tracked(collection, registry)
    data_identity, object_identity, armature_data, armature = _armature_resources(
        receipt, definition, deps
    )
    if (
        not armature.show_in_front
        or armature.display_type != "WIRE"
        or tuple(armature.users_collection) != (collection,)
    ):
        raise RuntimeError("Partial Armature object presentation or collection changed")
    expected_object_name = (
        _pending_object_name(receipt.receipt_id)
        if stage < 3
        else definition.object_name
    )
    expected_data_name = (
        _pending_data_name(receipt.receipt_id)
        if stage < 4
        else definition.data_name
    )
    if armature.name != expected_object_name or armature_data.name != expected_data_name:
        raise RuntimeError("Partial Armature name stage changed")

    collection_mutations = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.attribute == "users_collection"
    )
    binding_mutations = tuple(
        mutation for mutation in receipt.mutations if mutation.attribute == "bone_parent"
    )
    if (
        len(collection_mutations) != 1
        or collection_mutations[0].resource != object_identity
        or collection_mutations[0].before != ()
        or collection_mutations[0].after != (collection_identity,)
        or len(receipt.mutations)
        != 1 + (len(definition.bindings) if stage >= 8 else 0)
        or len(binding_mutations) != (len(definition.bindings) if stage >= 8 else 0)
    ):
        raise RuntimeError("Partial Armature receipt mutation set changed")

    if stage < 6:
        if len(armature_data.bones) != 0 or (
            armature.pose is not None and len(armature.pose.bones) != 0
        ):
            raise RuntimeError("Partial Armature contains premature bones")
    elif not _bones_match(armature, definition):
        raise RuntimeError("Partial Armature bone topology changed")

    targets = _binding_targets(receipts, definition, deps)
    if stage < 8:
        if any(target.parent is not None for _binding, _identity, target in targets):
            raise RuntimeError("Partial Armature contains a premature binding")
    else:
        for index, ((binding, target_identity, target), mutation) in enumerate(
            zip(targets, binding_mutations, strict=True)
        ):
            if (
                mutation.resource != target_identity
                or mutation.attribute != "bone_parent"
                or not isinstance(mutation.before, tuple)
                or len(mutation.before) != 5
                or mutation.before[0] is not None
                or not isinstance(mutation.after, tuple)
                or len(mutation.after) != 5
                or mutation.after[0] != object_identity
                or target.parent is not armature
                or target.parent_type != "BONE"
                or target.parent_bone != binding.bone_name
                or deps.parent_state(target, object_identity) != mutation.after
            ):
                raise RuntimeError(
                    f"Partial Armature binding {index + 1} changed"
                )
    return collection_identity, collection, object_identity, armature


def _create_armature(
    receipt: Any,
    collection_identity: Any,
    collection: Any,
    definition: Any,
    deps: Any,
) -> Any:
    created: list[Any] = []
    mutations: list[Any] = []
    try:
        armature_data = _bpy().data.armatures.new(
            _pending_data_name(receipt.receipt_id)
        )
        data_identity = deps.journal_created_resource(
            created,
            armature_data,
            f"{definition.logical_id}.data",
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
        )
        armature = _bpy().data.objects.new(
            _pending_object_name(receipt.receipt_id), armature_data
        )
        object_identity = deps.journal_created_resource(
            created,
            armature,
            definition.logical_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
        )
        armature.show_in_front = True
        armature.display_type = "WIRE"
        collection.objects.link(armature)
        mutations.append(
            deps.MutationRecord(
                object_identity,
                "users_collection",
                (),
                (collection_identity,),
            )
        )
        return deps.make_receipt(
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            created,
            mutations,
            [],
            object_identity,
        )
    except Exception:
        deps.rollback_partial(
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            created,
            mutations,
            [],
        )
        raise


def _armature_resource_mutations(
    ordinal: int, receipt: Any, definition: Any, deps: Any
) -> tuple[dict[str, Any], ...]:
    _data_identity, _object_identity, armature_data, armature = (
        _armature_resources(receipt, definition, deps)
    )
    if ordinal == 2:
        pending_object_name = _pending_object_name(receipt.receipt_id)
        pending_data_name = _pending_data_name(receipt.receipt_id)
        if (
            armature.name != pending_object_name
            or armature_data.name != pending_data_name
            or armature.bl_rna.identifier != "Object"
            or armature_data.bl_rna.identifier != "Armature"
            or armature.type != "ARMATURE"
            or armature.data is not armature_data
            or len(armature.users_collection) != 1
        ):
            raise RuntimeError("Armature resource creation was not observed exactly")
        return (
            {
                "order": 1,
                "executionMethod": "blender_rna_armature_data_create",
                "mcpTool": _ARMATURE_EXECUTE_TOOL,
                "sourceOperationId": ARMATURE_OPERATION_IDS[1],
                "semanticAction": ARMATURE_OPERATION_IDS[1],
                "valueSource": "managed_receipt_identity",
                "mutationKind": "armature_data_create",
                "armatureId": definition.logical_id,
                "pendingDataName": pending_data_name,
                "resourceType": armature_data.bl_rna.identifier,
                "observedResource": True,
                "uiPath": ["Layout", "Add", "Armature", "Data", pending_data_name],
            },
            {
                "order": 2,
                "executionMethod": "blender_rna_armature_object_create",
                "mcpTool": _ARMATURE_EXECUTE_TOOL,
                "sourceOperationId": ARMATURE_OPERATION_IDS[1],
                "semanticAction": ARMATURE_OPERATION_IDS[1],
                "valueSource": "managed_receipt_identity",
                "mutationKind": "armature_object_create",
                "armatureId": definition.logical_id,
                "pendingObjectName": pending_object_name,
                "pendingDataName": pending_data_name,
                "resourceType": armature.bl_rna.identifier,
                "objectType": armature.type,
                "observedDataBinding": True,
                "observedResource": True,
                "uiPath": [
                    "Layout",
                    "Add",
                    "Armature",
                    "Object",
                    pending_object_name,
                ],
            },
            {
                "order": 3,
                "executionMethod": "blender_rna_collection_object_link",
                "mcpTool": _ARMATURE_EXECUTE_TOOL,
                "sourceOperationId": ARMATURE_OPERATION_IDS[1],
                "semanticAction": ARMATURE_OPERATION_IDS[1],
                "valueSource": "accepted_action_argument",
                "actionArgument": "collectionId",
                "mutationKind": "collection_object_link",
                "armatureId": definition.logical_id,
                "collectionId": definition.collection_id,
                "pendingObjectName": pending_object_name,
                "observedLink": True,
                "uiPath": ["Outliner", definition.collection_id, pending_object_name],
            },
        )
    if ordinal == 3:
        if armature.name != definition.object_name:
            raise RuntimeError("Armature Object name write was not observed")
        return (
            {
                "order": 1,
                "executionMethod": "blender_rna_object_name_write",
                "mcpTool": _ARMATURE_EXECUTE_TOOL,
                "sourceOperationId": ARMATURE_OPERATION_IDS[2],
                "semanticAction": ARMATURE_OPERATION_IDS[2],
                "valueSource": "accepted_action_argument",
                "actionArgument": "objectName",
                "mutationKind": "armature_object_name_write",
                "armatureId": definition.logical_id,
                "beforeName": _pending_object_name(receipt.receipt_id),
                "acceptedName": definition.object_name,
                "observedName": armature.name,
                "uiPath": [
                    "Layout",
                    definition.object_name,
                    "Object Properties",
                    "Name",
                ],
            },
        )
    if ordinal == 4:
        if armature_data.name != definition.data_name:
            raise RuntimeError("Armature Data name write was not observed")
        return (
            {
                "order": 1,
                "executionMethod": "blender_rna_armature_data_name_write",
                "mcpTool": _ARMATURE_EXECUTE_TOOL,
                "sourceOperationId": ARMATURE_OPERATION_IDS[3],
                "semanticAction": ARMATURE_OPERATION_IDS[3],
                "valueSource": "accepted_action_argument",
                "actionArgument": "dataName",
                "mutationKind": "armature_data_name_write",
                "armatureId": definition.logical_id,
                "beforeName": _pending_data_name(receipt.receipt_id),
                "acceptedName": definition.data_name,
                "observedName": armature_data.name,
                "uiPath": [
                    "Layout",
                    definition.object_name,
                    "Object Data Properties",
                    "Name",
                ],
            },
        )
    return ()


def _bone_mutations(
    armature: Any, definition: Any
) -> tuple[dict[str, Any], ...]:
    actual_bones = {bone.name: bone for bone in armature.data.bones}
    actual_pose_bones = {bone.name: bone for bone in armature.pose.bones}
    accepted_names = {bone.name for bone in definition.bones}
    if set(actual_bones) != accepted_names or set(actual_pose_bones) != accepted_names:
        raise RuntimeError("Armature bone mutation readback is incomplete")
    mutations: list[dict[str, Any]] = []
    for bone_order, accepted in enumerate(definition.bones, start=1):
        observed = actual_bones[accepted.name]
        observed_head = [float(value) for value in observed.head_local]
        observed_tail = [float(value) for value in observed.tail_local]
        if (
            not _vector_close(observed_head, accepted.head)
            or not _vector_close(observed_tail, accepted.tail)
            or bool(observed.use_deform)
        ):
            raise RuntimeError(f"Armature EditBone readback changed: {accepted.name}")
        mutations.append(
            {
                "order": len(mutations) + 1,
                "boneOrder": bone_order,
                "executionMethod": "blender_rna_edit_bone_create",
                "mcpTool": _ARMATURE_EXECUTE_TOOL,
                "sourceOperationId": ARMATURE_OPERATION_IDS[5],
                "semanticAction": ARMATURE_OPERATION_IDS[5],
                "valueSource": "accepted_action_argument",
                "actionArgument": "bones",
                "mutationKind": "edit_bone_create",
                "armatureId": definition.logical_id,
                "dataName": definition.data_name,
                "boneName": accepted.name,
                "acceptedHead": [float(value) for value in accepted.head],
                "observedHead": observed_head,
                "acceptedTail": [float(value) for value in accepted.tail],
                "observedTail": observed_tail,
                "acceptedUseDeform": False,
                "observedUseDeform": bool(observed.use_deform),
                "observedBone": True,
                "uiPath": [
                    "Layout",
                    definition.object_name,
                    "Edit Mode",
                    "Bones",
                    accepted.name,
                ],
            }
        )
    for bone_order, accepted in enumerate(definition.bones, start=1):
        if accepted.parent_name is None:
            continue
        observed = actual_bones[accepted.name]
        observed_parent = observed.parent.name if observed.parent is not None else None
        if observed_parent != accepted.parent_name:
            raise RuntimeError(f"Armature EditBone parent changed: {accepted.name}")
        mutations.append(
            {
                "order": len(mutations) + 1,
                "boneOrder": bone_order,
                "executionMethod": "blender_rna_edit_bone_parent_bind",
                "mcpTool": _ARMATURE_EXECUTE_TOOL,
                "sourceOperationId": ARMATURE_OPERATION_IDS[5],
                "semanticAction": ARMATURE_OPERATION_IDS[5],
                "valueSource": "accepted_action_argument",
                "actionArgument": "bones",
                "mutationKind": "edit_bone_parent_bind",
                "armatureId": definition.logical_id,
                "dataName": definition.data_name,
                "boneName": accepted.name,
                "acceptedParentName": accepted.parent_name,
                "observedParentName": observed_parent,
                "observedBinding": True,
                "uiPath": [
                    "Layout",
                    definition.object_name,
                    "Edit Mode",
                    "Bones",
                    accepted.name,
                    "Parent",
                    accepted.parent_name,
                ],
            }
        )
    for bone_order, accepted in enumerate(definition.bones, start=1):
        observed = actual_pose_bones[accepted.name]
        if observed.rotation_mode != "XYZ":
            raise RuntimeError(f"Armature PoseBone rotation mode changed: {accepted.name}")
        mutations.append(
            {
                "order": len(mutations) + 1,
                "boneOrder": bone_order,
                "executionMethod": "blender_rna_pose_bone_rotation_mode_write",
                "mcpTool": _ARMATURE_EXECUTE_TOOL,
                "sourceOperationId": ARMATURE_OPERATION_IDS[5],
                "semanticAction": ARMATURE_OPERATION_IDS[5],
                "valueSource": "catalog_constant",
                "actionArgument": None,
                "mutationKind": "pose_bone_rotation_mode_write",
                "armatureId": definition.logical_id,
                "boneName": accepted.name,
                "acceptedRotationMode": "XYZ",
                "observedRotationMode": observed.rotation_mode,
                "uiPath": [
                    "Pose Mode",
                    definition.object_name,
                    "Bone",
                    accepted.name,
                    "Rotation Mode",
                ],
            }
        )
    return tuple(mutations)


def _create_bones(
    armature: Any, definition: Any, deps: Any
) -> tuple[dict[str, Any], ...]:
    try:
        deps.create_edit_bones(armature, definition.bones)
        for pose_bone in armature.pose.bones:
            pose_bone.rotation_mode = "XYZ"
        return _bone_mutations(armature, definition)
    except Exception:
        _clear_edit_bones(armature, deps)
        raise


def _bind_targets(
    receipt: Any,
    receipts: Mapping[str, Any],
    definition: Any,
    armature_identity: Any,
    armature: Any,
    deps: Any,
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    binding_mutations: list[Any] = []
    binding_receipts: list[dict[str, Any]] = []
    try:
        for binding_order, (binding, target_identity, target) in enumerate(
            _binding_targets(receipts, definition, deps), start=1
        ):
            _bpy().context.view_layer.update()
            before = deps.parent_state(target, None)
            before_parent = target.parent
            before_parent_type = target.parent_type
            before_parent_bone = target.parent_bone
            world_matrix = target.matrix_world.copy()
            before_parent_inverse = target.matrix_parent_inverse.copy()
            before_basis = target.matrix_basis.copy()
            try:
                target.parent = armature
                target.parent_type = "BONE"
                target.parent_bone = binding.bone_name
                target.matrix_world = world_matrix
                after = deps.parent_state(target, armature_identity)
                world_preserved = _matrix_close(target.matrix_world, world_matrix)
                if (
                    target.parent is not armature
                    or target.parent_type != "BONE"
                    or target.parent_bone != binding.bone_name
                    or not world_preserved
                ):
                    raise RuntimeError(
                        "Armature rigid binding was not observed exactly: "
                        f"{binding.target_id}"
                    )
            except Exception:
                deps.restore_parent_state_locally(
                    target,
                    before_parent,
                    before_parent_type,
                    before_parent_bone,
                    world_matrix,
                    before_parent_inverse,
                    before_basis,
                )
                raise
            binding_mutations.append(
                deps.MutationRecord(target_identity, "bone_parent", before, after)
            )
            binding_receipts.append(
                {
                    "order": binding_order,
                    "bindingOrder": binding_order,
                    "executionMethod": "blender_rna_object_bone_parent_write",
                    "mcpTool": _ARMATURE_EXECUTE_TOOL,
                    "sourceOperationId": ARMATURE_OPERATION_IDS[7],
                    "semanticAction": ARMATURE_OPERATION_IDS[7],
                    "valueSource": "accepted_action_argument",
                    "actionArgument": "bindings",
                    "mutationKind": "object_bone_parent_write",
                    "targetId": binding.target_id,
                    "armatureId": definition.logical_id,
                    "boneName": binding.bone_name,
                    "acceptedParentType": "BONE",
                    "observedParentType": target.parent_type,
                    "acceptedParentBone": binding.bone_name,
                    "observedParentBone": target.parent_bone,
                    "observedParent": True,
                    "observedWorldMatrixPreserved": world_preserved,
                    "uiPath": [
                        "Layout",
                        binding.target_id,
                        "Parent",
                        definition.logical_id,
                        "Bone",
                        binding.bone_name,
                    ],
                }
            )
    except Exception:
        if binding_mutations:
            deps.rollback_partial(
                receipt.receipt_id,
                receipt.step_id,
                receipt.action_name,
                [],
                binding_mutations,
                [],
            )
        raise
    return (
        replace(receipt, mutations=(*receipt.mutations, *binding_mutations)),
        tuple(binding_receipts),
    )


def _remove_bindings(receipt: Any, deps: Any) -> Any:
    binding_mutations = tuple(
        mutation for mutation in receipt.mutations if mutation.attribute == "bone_parent"
    )
    mini_receipt = deps.make_receipt(
        receipt.receipt_id,
        receipt.step_id,
        receipt.action_name,
        [],
        list(binding_mutations),
        [],
        receipt.anchor,
    )
    deps.rollback_receipt(mini_receipt)
    return replace(
        receipt,
        mutations=tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.attribute != "bone_parent"
        ),
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
    rna_armature_resource_mutations: tuple[dict[str, Any], ...] = (),
    rna_armature_bone_mutations: tuple[dict[str, Any], ...] = (),
    rna_armature_binding_mutations: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    stage = completed[-1] if completed else 0
    return {
        "kind": "guided_armature_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": direction,
            "operationOrdinal": ordinal,
            "operationId": ARMATURE_OPERATION_IDS[ordinal - 1],
            "mutating": ordinal in ARMATURE_MUTATING_ORDINALS,
            "receiptId": receipt.receipt_id,
            "stepId": receipt.step_id,
            "actionName": receipt.action_name,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(completed),
                "preconditionsValidated": ordinal == 1,
                "completeArmature": ordinal == len(ARMATURE_OPERATION_IDS),
                "stage": min(stage, 8),
                "collectionId": definition.collection_id,
                "armatureId": definition.logical_id if stage >= 2 else None,
                "objectNameApplied": stage >= 3,
                "dataNameApplied": stage >= 4,
                "resolvedObjectName": definition.object_name if stage >= 3 else None,
                "resolvedDataName": definition.data_name if stage >= 4 else None,
                "boneCount": len(definition.bones) if stage >= 6 else 0,
                "bindingCount": len(definition.bindings) if stage >= 8 else 0,
                "bonesApplied": stage >= 6,
                "bindingsApplied": stage >= 8,
                "rnaArmatureResourceMutations": list(
                    rna_armature_resource_mutations
                ),
                "rnaArmatureBoneMutations": list(rna_armature_bone_mutations),
                "rnaArmatureBindingMutations": list(
                    rna_armature_binding_mutations
                ),
            },
        },
    }


def resume_armature_transaction(
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
        raise ValueError("A resumed Armature transaction requires its receipt and fingerprint")
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
) -> tuple[Any, Any | None]:
    if (
        transaction.completed_operations != completed_operations
        or transaction.definition_fingerprint != _definition_fingerprint(definition)
        or transaction.receipt.receipt_id != receipt_id
        or transaction.receipt.step_id != step_id
        or transaction.receipt.action_name != action_name
    ):
        raise RuntimeError("Guided Armature transaction binding changed")
    _collection_identity, _collection, armature_identity, armature = _validate_stage(
        receipts,
        transaction.receipt,
        definition,
        completed_operations,
        deps,
    )
    stage = completed_operations[-1] if completed_operations else 0
    if (
        _fingerprint(receipts, transaction.receipt, definition, stage, deps)
        != transaction.fingerprint
    ):
        raise RuntimeError("Guided Armature transaction fingerprint changed")
    return armature_identity, armature


def verify_armature_stage(
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
        ordinal in ARMATURE_MUTATING_ORDINALS for ordinal in completed_operations
    )
    if receipt_required:
        if rebound_partial is None:
            raise RuntimeError("Armature partial receipt is unavailable")
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
        receipt = rebound_partial
    else:
        if rebound_partial is not None:
            raise RuntimeError("Armature pre-mutation stage contains a receipt")
        collection_identity, _collection = _owned_collection(
            rebound_receipts, definition, deps
        )
        receipt = _empty_receipt(
            receipt_id, step_id, action_name, collection_identity, deps
        )
        _validate_stage(
            rebound_receipts, receipt, definition, completed_operations, deps
        )
    stage = completed_operations[-1] if completed_operations else 0
    if (
        _fingerprint(rebound_receipts, receipt, definition, stage, deps)
        != expected_fingerprint
    ):
        raise RuntimeError("Armature stage fingerprint changed")
    return True


def execute_armature_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction | None = None,
) -> GuidedGeometryOperationResult:
    if action_name != ARMATURE_ACTION:
        raise ValueError(f"Unsupported guided Armature action: {action_name}")
    if not 1 <= operation_ordinal <= len(ARMATURE_OPERATION_IDS):
        raise ValueError("operation_ordinal must be in [1, 9]")
    deps = _dependencies()
    expected_completed = tuple(range(1, operation_ordinal))
    if transaction is None:
        if operation_ordinal != 1:
            raise RuntimeError("Guided Armature operation 01 must start the transaction")
        collection_identity, _collection = _owned_collection(receipts, definition, deps)
        receipt = _empty_receipt(
            receipt_id, step_id, action_name, collection_identity, deps
        )
        armature_identity = None
        armature = None
        before = _fingerprint(receipts, receipt, definition, 0, deps)
    else:
        armature_identity, armature = _validate_transaction(
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

    rna_armature_resource_mutations: tuple[dict[str, Any], ...] = ()
    rna_armature_bone_mutations: tuple[dict[str, Any], ...] = ()
    rna_armature_binding_mutations: tuple[dict[str, Any], ...] = ()
    try:
        if operation_ordinal == 1:
            _preflight(receipts, definition, receipt_id, deps)
        elif operation_ordinal == 2:
            collection_identity, collection = _preflight(
                receipts, definition, receipt_id, deps
            )
            receipt = _create_armature(
                receipt, collection_identity, collection, definition, deps
            )
            rna_armature_resource_mutations = _armature_resource_mutations(
                operation_ordinal, receipt, definition, deps
            )
        elif operation_ordinal == 3:
            deps.ensure_name_available(
                _bpy().data.objects, definition.object_name, "object"
            )
            receipt = _rename_object(
                receipt, definition, definition.object_name, deps
            )
            rna_armature_resource_mutations = _armature_resource_mutations(
                operation_ordinal, receipt, definition, deps
            )
        elif operation_ordinal == 4:
            deps.ensure_name_available(
                _bpy().data.armatures, definition.data_name, "armature data"
            )
            receipt = _rename_data(receipt, definition, definition.data_name, deps)
            rna_armature_resource_mutations = _armature_resource_mutations(
                operation_ordinal, receipt, definition, deps
            )
        elif operation_ordinal == 6:
            rna_armature_bone_mutations = _create_bones(
                armature, definition, deps
            )
        elif operation_ordinal == 8:
            receipt, rna_armature_binding_mutations = _bind_targets(
                receipt,
                receipts,
                definition,
                armature_identity,
                armature,
                deps,
            )
        else:
            _validate_stage(
                receipts, receipt, definition, expected_completed, deps
            )
        completed = (*expected_completed, operation_ordinal)
        _collection_identity, _collection, armature_identity, armature = _validate_stage(
            receipts, receipt, definition, completed, deps
        )
    except GuidedGeometryAtomicityError:
        raise
    except Exception as error:
        try:
            if operation_ordinal == 2 and receipt.created:
                deps.rollback_receipt(receipt, allow_incomplete=True)
                collection_identity, _collection = _owned_collection(
                    receipts, definition, deps
                )
                receipt = _empty_receipt(
                    receipt_id, step_id, action_name, collection_identity, deps
                )
            elif operation_ordinal == 3 and armature is not None:
                receipt = _rename_object(
                    receipt, definition, _pending_object_name(receipt_id), deps
                )
            elif operation_ordinal == 4 and armature is not None:
                receipt = _rename_data(
                    receipt, definition, _pending_data_name(receipt_id), deps
                )
            elif operation_ordinal == 6 and armature is not None:
                _clear_edit_bones(armature, deps)
            elif operation_ordinal == 8 and any(
                mutation.attribute == "bone_parent" for mutation in receipt.mutations
            ):
                receipt = _remove_bindings(receipt, deps)
            _validate_stage(
                receipts, receipt, definition, expected_completed, deps
            )
            prior_stage = expected_completed[-1] if expected_completed else 0
            if (
                _fingerprint(receipts, receipt, definition, prior_stage, deps)
                != before
            ):
                raise RuntimeError("Armature compensation fingerprint changed")
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                "Guided Armature forward operation "
                f"{operation_ordinal:02d} failed and rollback failed"
            ) from recovery_error
        raise error

    stage = completed[-1]
    after = _fingerprint(receipts, receipt, definition, stage, deps)
    result_transaction = GuidedGeometryTransaction(
        receipt, completed, after, _definition_fingerprint(definition)
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
            rna_armature_resource_mutations=rna_armature_resource_mutations,
            rna_armature_bone_mutations=rna_armature_bone_mutations,
            rna_armature_binding_mutations=rna_armature_binding_mutations,
        ),
        before,
        after,
    )


def inverse_armature_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction,
) -> GuidedGeometryOperationResult:
    if action_name != ARMATURE_ACTION:
        raise ValueError(f"Unsupported guided Armature action: {action_name}")
    if (
        not transaction.completed_operations
        or transaction.completed_operations[-1] != operation_ordinal
    ):
        raise RuntimeError("Guided Armature inverse must target the latest operation")
    deps = _dependencies()
    _armature_identity, armature = _validate_transaction(
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
        receipt = _remove_bindings(receipt, deps)
    elif operation_ordinal == 6:
        _clear_edit_bones(armature, deps)
    elif operation_ordinal == 4:
        receipt = _rename_data(
            receipt, definition, _pending_data_name(receipt_id), deps
        )
    elif operation_ordinal == 3:
        receipt = _rename_object(
            receipt, definition, _pending_object_name(receipt_id), deps
        )
    elif operation_ordinal == 2:
        deps.rollback_receipt(receipt, allow_incomplete=True)
        collection_identity, _collection = _owned_collection(receipts, definition, deps)
        receipt = _empty_receipt(
            receipt_id, step_id, action_name, collection_identity, deps
        )
    completed = transaction.completed_operations[:-1]
    _validate_stage(receipts, receipt, definition, completed, deps)
    stage = completed[-1] if completed else 0
    after = _fingerprint(receipts, receipt, definition, stage, deps)
    result_transaction = GuidedGeometryTransaction(
        receipt, completed, after, transaction.definition_fingerprint
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
    "ARMATURE_ACTION",
    "ARMATURE_MUTATING_ORDINALS",
    "ARMATURE_OPERATION_IDS",
    "execute_armature_operation",
    "inverse_armature_operation",
    "resume_armature_transaction",
    "verify_armature_stage",
)
