"""Operation-level execution for the bounded Transform Geometry guide leaf.

The existing action executor intentionally remains the atomic, whole-leaf path.
This module exposes the same recipe as eleven strictly ordered operations so the
guided UI can execute, observe, and reverse one instruction at a time.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import hashlib
import math
from types import SimpleNamespace
from typing import Any, Mapping


TRANSFORM_GEOMETRY_ACTION = "blender.geometry_nodes.create_transform"
_INPUT_NODE_NAME = "OperatingLine Input"
_TRANSFORM_NODE_NAME = "OperatingLine Transform"
_OUTPUT_NODE_NAME = "OperatingLine Output"
_DEFAULT_TRANSLATION = (0.0, 0.0, 0.0)
_DEFAULT_ROTATION = (0.0, 0.0, 0.0)
_DEFAULT_SCALE = (1.0, 1.0, 1.0)
_TRANSFORM_EXECUTE_TOOL = (
    "operatingline.blender.geometry-nodes.transform.execute-next"
)
_VECTOR_COMPONENT_LABELS = ("X", "Y", "Z")
_OPERATION_IDS = (
    "semantic.preflight_transform_geometry_resources",
    "semantic.new_geometry_modifier",
    "node.group_input",
    "node.transform_geometry",
    "projection.semantic.transform_geometry.translation",
    "projection.semantic.transform_geometry.rotation",
    "projection.semantic.transform_geometry.scale",
    "node.group_output",
    "semantic.connect_group_input_geometry_to_transform",
    "semantic.connect_transform_geometry_to_group_output",
    "semantic.verify_node_links",
)


class GuidedGeometryAtomicityError(RuntimeError):
    """A guided operation failed and its prior Blender state could not be proven."""


@dataclass(frozen=True, slots=True)
class GuidedGeometryTransaction:
    """Caller-owned progress and the aggregate partial action receipt."""

    receipt: Any
    completed_operations: tuple[int, ...]
    fingerprint: str
    definition_fingerprint: str


@dataclass(frozen=True, slots=True)
class GuidedGeometryOperationResult:
    """One verified forward or inverse operation transition."""

    transaction: GuidedGeometryTransaction
    observation: dict[str, Any]
    before_fingerprint: str
    after_fingerprint: str

    @property
    def receipt(self) -> Any:
        return self.transaction.receipt


def _dependencies() -> SimpleNamespace:
    # Keep this module importable by the repository's pure-Python unit suite.
    from ..application.session import ModifierState, MutationRecord
    from .snowman_actions.common import (
        build_resource_registry,
        ensure_logical_ids_available,
        ensure_modifier_id_available,
        ensure_name_available,
        ensure_receipts_intact,
        make_receipt,
        node_tree_signature,
        owned_resource,
        rebind_receipts_after_native_restore,
        resolve_resource,
        rollback_partial,
        rollback_receipt,
        snapshot_modifier,
        tag_resource,
    )

    return SimpleNamespace(
        ModifierState=ModifierState,
        MutationRecord=MutationRecord,
        build_resource_registry=build_resource_registry,
        ensure_logical_ids_available=ensure_logical_ids_available,
        ensure_modifier_id_available=ensure_modifier_id_available,
        ensure_name_available=ensure_name_available,
        ensure_receipts_intact=ensure_receipts_intact,
        make_receipt=make_receipt,
        node_tree_signature=node_tree_signature,
        owned_resource=owned_resource,
        rebind_receipts_after_native_restore=rebind_receipts_after_native_restore,
        resolve_resource=resolve_resource,
        rollback_partial=rollback_partial,
        rollback_receipt=rollback_receipt,
        snapshot_modifier=snapshot_modifier,
        tag_resource=tag_resource,
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
            definition.node_group_id,
            definition.node_group_name,
            tuple(definition.translation),
            tuple(definition.rotation),
            tuple(definition.scale),
        )
    )


def _socket(sockets: Any, identifier: str) -> Any:
    matches = tuple(socket for socket in sockets if socket.identifier == identifier)
    if len(matches) != 1:
        raise RuntimeError(
            f"Geometry Nodes socket {identifier!r} must be unique; found {len(matches)}"
        )
    return matches[0]


def _interface_socket(node_group: Any, in_out: str) -> Any:
    matches = tuple(
        item
        for item in node_group.interface.items_tree
        if item.item_type == "SOCKET"
        and item.name == "Geometry"
        and item.in_out == in_out
        and item.socket_type == "NodeSocketGeometry"
    )
    if len(matches) != 1:
        raise RuntimeError(
            f"Geometry Nodes {in_out.lower()} interface socket must be unique; "
            f"found {len(matches)}"
        )
    return matches[0]


def _owned_target(
    receipts: Mapping[str, Any], target_id: str, deps: Any
) -> tuple[Any, Any]:
    registry = deps.build_resource_registry(receipts)
    target_identity, target = deps.owned_resource(registry, target_id, "OBJECT")
    if getattr(target, "type", None) != "MESH":
        raise ValueError(f"Owned target is not a mesh object: {target_id}")
    mesh_is_owned = any(
        identity.resource_type == "MESH"
        and deps.resolve_resource(identity) is target.data
        for identity in registry.values()
    )
    if not mesh_is_owned:
        raise RuntimeError(f"Owned mesh data is unavailable: {target_id}")
    return target_identity, target


def _empty_receipt(
    receipt_id: str,
    step_id: str,
    action_name: str,
    anchor: Any,
    deps: Any,
) -> Any:
    return deps.make_receipt(receipt_id, step_id, action_name, [], [], [], anchor)


def _node_group_identity(receipt: Any, definition: Any) -> Any:
    matches = tuple(
        identity
        for identity in receipt.created
        if identity.resource_type == "NODE_GROUP"
        and identity.logical_id == definition.node_group_id
    )
    if len(matches) != 1:
        raise RuntimeError("Partial receipt must own exactly one Transform node group")
    return matches[0]


def _node_tree_mutation(receipt: Any, definition: Any) -> Any:
    matches = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.resource.logical_id == definition.node_group_id
        and mutation.attribute == "node_tree_signature"
    )
    if len(matches) != 1:
        raise RuntimeError("Partial receipt must contain one node-tree mutation")
    return matches[0]


def _modifier_mutation(receipt: Any, definition: Any, deps: Any) -> Any:
    matches = tuple(
        mutation
        for mutation in receipt.mutations
        if isinstance(mutation.after, deps.ModifierState)
        and mutation.after.logical_id == definition.modifier_id
    )
    if len(matches) != 1:
        raise RuntimeError("Partial receipt must contain one Geometry Nodes modifier")
    return matches[0]


def _resolve_partial_resources(receipt: Any, definition: Any, deps: Any) -> tuple[Any, Any, Any]:
    node_identity = _node_group_identity(receipt, definition)
    if (
        node_identity.receipt_token != receipt.receipt_id
        or node_identity.step_id != receipt.step_id
        or node_identity.action_name != receipt.action_name
    ):
        raise RuntimeError("Partial Transform node-group ownership binding changed")
    node_group = deps.resolve_resource(node_identity)
    if node_group is None:
        raise RuntimeError("Partial Transform node group is unavailable")
    modifier_mutation = _modifier_mutation(receipt, definition, deps)
    target = deps.resolve_resource(modifier_mutation.resource)
    if target is None:
        raise RuntimeError("Partial Transform modifier owner is unavailable")
    state = modifier_mutation.after
    if (
        state.receipt_token != receipt.receipt_id
        or state.step_id != receipt.step_id
        or state.action_name != receipt.action_name
    ):
        raise RuntimeError("Partial Transform modifier ownership binding changed")
    if not 0 <= state.stack_index < len(target.modifiers):
        raise RuntimeError("Partial Transform modifier stack binding changed")
    modifier = target.modifiers[state.stack_index]
    if (
        modifier.as_pointer() != state.pointer
        or modifier.name != definition.modifier_name
        or modifier.type != "NODES"
        or modifier.node_group is not node_group
    ):
        raise RuntimeError("Partial Transform modifier binding changed")
    return target, modifier, node_group


def _vector(socket: Any) -> tuple[float, float, float]:
    return tuple(float(component) for component in socket.default_value)


def _vector_matches(socket: Any, expected: tuple[float, ...]) -> bool:
    actual = _vector(socket)
    return len(actual) == len(expected) and all(
        math.isclose(component, float(wanted), rel_tol=1e-6, abs_tol=1e-7)
        for component, wanted in zip(actual, expected, strict=True)
    )


def _validate_stage(node_group: Any, stage: int, definition: Any) -> None:
    if not 2 <= stage <= 10:
        raise ValueError(f"Node-tree stage is outside [2, 10]: {stage}")
    expected_nodes: dict[str, str] = {}
    if stage >= 3:
        expected_nodes[_INPUT_NODE_NAME] = "NodeGroupInput"
    if stage >= 4:
        expected_nodes[_TRANSFORM_NODE_NAME] = "GeometryNodeTransform"
    if stage >= 8:
        expected_nodes[_OUTPUT_NODE_NAME] = "NodeGroupOutput"
    actual_nodes = {node.name: node.bl_idname for node in node_group.nodes}
    if actual_nodes != expected_nodes:
        raise RuntimeError("Transform node-tree nodes do not match the guided stage")

    # Blender presents output sockets before input sockets regardless of the
    # order in which the interface items were created.
    expected_interface = []
    if stage >= 8:
        expected_interface.append(("Geometry", "OUTPUT", "NodeSocketGeometry"))
    if stage >= 3:
        expected_interface.append(("Geometry", "INPUT", "NodeSocketGeometry"))
    actual_interface = [
        (item.name, item.in_out, item.socket_type)
        for item in node_group.interface.items_tree
        if item.item_type == "SOCKET"
    ]
    if actual_interface != expected_interface:
        raise RuntimeError("Transform node-tree interface does not match the guided stage")

    if stage >= 3:
        input_node = node_group.nodes.get(_INPUT_NODE_NAME)
        if tuple(float(value) for value in input_node.location) != (-320.0, 0.0):
            raise RuntimeError("Transform input node placement changed")
    if stage >= 4:
        transform = node_group.nodes.get(_TRANSFORM_NODE_NAME)
        if tuple(float(value) for value in transform.location) != (0.0, 0.0):
            raise RuntimeError("Transform node placement changed")
        expected_translation = (
            tuple(definition.translation) if stage >= 5 else _DEFAULT_TRANSLATION
        )
        expected_rotation = (
            tuple(definition.rotation) if stage >= 6 else _DEFAULT_ROTATION
        )
        expected_scale = tuple(definition.scale) if stage >= 7 else _DEFAULT_SCALE
        if not _vector_matches(
            _socket(transform.inputs, "Translation"), expected_translation
        ):
            raise RuntimeError("Transform Translation no longer matches the guided value")
        if not _vector_matches(
            _socket(transform.inputs, "Rotation"), expected_rotation
        ):
            raise RuntimeError("Transform Rotation no longer matches the guided value")
        if not _vector_matches(_socket(transform.inputs, "Scale"), expected_scale):
            raise RuntimeError("Transform Scale no longer matches the guided value")
    if stage >= 8:
        output_node = node_group.nodes.get(_OUTPUT_NODE_NAME)
        if tuple(float(value) for value in output_node.location) != (320.0, 0.0):
            raise RuntimeError("Transform output node placement changed")

    actual_links = tuple(
        sorted(
            (
                link.from_node.name,
                link.from_socket.identifier,
                link.to_node.name,
                link.to_socket.identifier,
            )
            for link in node_group.links
        )
    )
    expected_links: list[tuple[str, str, str, str]] = []
    if stage >= 9:
        input_interface = _interface_socket(node_group, "INPUT")
        expected_links.append(
            (_INPUT_NODE_NAME, input_interface.identifier, _TRANSFORM_NODE_NAME, "Geometry")
        )
    if stage >= 10:
        output_interface = _interface_socket(node_group, "OUTPUT")
        expected_links.append(
            (_TRANSFORM_NODE_NAME, "Geometry", _OUTPUT_NODE_NAME, output_interface.identifier)
        )
    if actual_links != tuple(sorted(expected_links)):
        raise RuntimeError("Transform node-tree links do not match the guided stage")


def _fingerprint(target: Any, node_group: Any | None, deps: Any) -> str:
    def stable_identity(resource: Any) -> tuple[str, Any]:
        session_uid = getattr(resource, "session_uid", None)
        if isinstance(session_uid, int) and session_uid > 0:
            return ("session_uid", session_uid)
        return ("test_pointer", resource.as_pointer())

    modifier_state = tuple(
        (
            index,
            modifier.name,
            modifier.type,
            (
                stable_identity(modifier.node_group)
                if getattr(modifier, "node_group", None) is not None
                else None
            ),
        )
        for index, modifier in enumerate(target.modifiers)
    )
    node_state = None if node_group is None else deps.node_tree_signature(node_group)
    return _digest(
        (
            stable_identity(target),
            stable_identity(target.data),
            modifier_state,
            node_state,
        )
    )


def _validate_transaction(
    transaction: GuidedGeometryTransaction,
    receipt_id: str,
    step_id: str,
    action_name: str,
    expected_completed: tuple[int, ...],
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
) -> tuple[Any, Any | None]:
    receipt = transaction.receipt
    if (
        receipt.receipt_id != receipt_id
        or receipt.step_id != step_id
        or receipt.action_name != action_name
    ):
        raise RuntimeError("Guided Geometry transaction receipt binding changed")
    if transaction.completed_operations != expected_completed:
        raise RuntimeError("Guided Geometry operations must execute in strict order")
    if expected_completed != tuple(range(1, len(expected_completed) + 1)):
        raise RuntimeError("Guided Geometry transaction history is not a valid prefix")
    if transaction.definition_fingerprint != _definition_fingerprint(definition):
        raise RuntimeError("Guided Geometry accepted parameters changed mid-transaction")
    deps.ensure_receipts_intact(receipts)
    target_identity, target = _owned_target(receipts, definition.target_id, deps)
    if receipt.anchor != target_identity:
        raise RuntimeError("Guided Geometry transaction target binding changed")
    node_group = None
    if expected_completed and expected_completed[-1] >= 2:
        if (
            len(receipt.created) != 1
            or len(receipt.mutations) != 2
            or receipt.artifacts
        ):
            raise RuntimeError("Partial Transform receipt has unexpected effects")
        deps.ensure_receipts_intact({"guided-partial": receipt})
        _target, _modifier, node_group = _resolve_partial_resources(
            receipt, definition, deps
        )
        _validate_stage(node_group, min(expected_completed[-1], 10), definition)
    elif receipt.created or receipt.mutations or receipt.artifacts:
        raise RuntimeError("Precondition-only guided receipt must not own effects")
    current_fingerprint = _fingerprint(target, node_group, deps)
    if current_fingerprint != transaction.fingerprint:
        raise RuntimeError("Guided Geometry resources changed outside the transaction")
    return target, node_group


def _replace_node_signature(
    receipt: Any, node_group: Any, definition: Any, deps: Any
) -> Any:
    current = _node_tree_mutation(receipt, definition)
    updated = replace(current, after=deps.node_tree_signature(node_group))
    return replace(
        receipt,
        mutations=tuple(
            updated if mutation is current else mutation
            for mutation in receipt.mutations
        ),
    )


def _create_base_resources(
    receipt: Any,
    target: Any,
    definition: Any,
    deps: Any,
) -> tuple[Any, Any]:
    bpy = _bpy()
    created: list[Any] = []
    mutations: list[Any] = []
    modifier = None
    try:
        node_group = bpy.data.node_groups.new(
            definition.node_group_name, "GeometryNodeTree"
        )
        identity = deps.tag_resource(
            node_group,
            definition.node_group_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
        )
        created.append(identity)
        modifier = target.modifiers.new(definition.modifier_name, "NODES")
        modifier.node_group = node_group
        modifier_state = deps.snapshot_modifier(
            target,
            modifier,
            definition.modifier_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            {"node_group": identity},
        )
        mutations.append(
            deps.MutationRecord(
                receipt.anchor,
                f"modifier:{definition.modifier_id}",
                None,
                modifier_state,
            )
        )
        mutations.append(
            deps.MutationRecord(
                identity,
                "node_tree_signature",
                None,
                deps.node_tree_signature(node_group),
            )
        )
        return replace(receipt, created=tuple(created), mutations=tuple(mutations)), node_group
    except Exception as error:
        try:
            if modifier is not None and not mutations:
                target.modifiers.remove(modifier)
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
                "Guided Geometry operation 02 failed and base-resource cleanup failed"
            ) from recovery_error
        raise


def _add_interface_and_node(
    node_group: Any,
    in_out: str,
    node_type: str,
    name: str,
    location: tuple[float, float],
) -> None:
    interface = None
    node = None
    try:
        interface = node_group.interface.new_socket(
            name="Geometry", in_out=in_out, socket_type="NodeSocketGeometry"
        )
        node = node_group.nodes.new(node_type)
        node.name = name
        node.location = location
    except Exception:
        if node is not None:
            node_group.nodes.remove(node)
        if interface is not None:
            node_group.interface.remove(interface)
        raise


def _remove_link(node_group: Any, from_name: str, to_name: str) -> None:
    matches = tuple(
        link
        for link in node_group.links
        if link.from_node.name == from_name and link.to_node.name == to_name
    )
    if len(matches) != 1:
        raise RuntimeError("Expected one guided Geometry Nodes link")
    node_group.links.remove(matches[0])


def _write_vector_socket_components(
    socket: Any,
    accepted: tuple[float, ...],
    *,
    definition: Any,
    socket_identifier: str,
    action_argument: str,
    source_operation_id: str,
) -> tuple[dict[str, Any], ...]:
    """Write one Blender RNA vector component at a time and return exact evidence."""

    if len(accepted) != len(_VECTOR_COMPONENT_LABELS):
        raise ValueError("Transform Geometry vector parameters must contain X, Y, and Z")
    current = _vector(socket)
    writes: list[dict[str, Any]] = []
    for component_index, component_label in enumerate(_VECTOR_COMPONENT_LABELS):
        before_value = current[component_index]
        accepted_value = float(accepted[component_index])
        socket.default_value[component_index] = accepted_value
        observed = _vector(socket)
        expected = list(current)
        expected[component_index] = accepted_value
        if len(observed) != len(expected) or not all(
            math.isclose(value, wanted, rel_tol=1e-6, abs_tol=1e-7)
            for value, wanted in zip(observed, expected, strict=True)
        ):
            raise RuntimeError(
                f"Transform {socket_identifier} {component_label} RNA write was not observed"
            )
        writes.append(
            {
                "order": component_index + 1,
                "executionMethod": "blender_rna_property_write",
                "mcpTool": _TRANSFORM_EXECUTE_TOOL,
                "sourceOperationId": source_operation_id,
                "semanticAction": "node.transform_geometry",
                "actionArgument": action_argument,
                "nodeGroupId": definition.node_group_id,
                "nodeGroupName": definition.node_group_name,
                "nodeName": _TRANSFORM_NODE_NAME,
                "nodeType": "GeometryNodeTransform",
                "socketIdentifier": socket_identifier,
                "propertyName": "default_value",
                "componentIndex": component_index,
                "componentLabel": component_label,
                "beforeValue": before_value,
                "acceptedValue": accepted_value,
                "observedValue": observed[component_index],
                "uiPath": [
                    "Geometry Nodes",
                    definition.node_group_name,
                    _TRANSFORM_NODE_NAME,
                    socket_identifier,
                    component_label,
                ],
            }
        )
        current = observed
    return tuple(writes)


def _apply_forward(
    operation: int, node_group: Any, definition: Any
) -> tuple[dict[str, Any], ...]:
    if operation == 3:
        _add_interface_and_node(
            node_group, "INPUT", "NodeGroupInput", _INPUT_NODE_NAME, (-320.0, 0.0)
        )
    elif operation == 4:
        node = node_group.nodes.new("GeometryNodeTransform")
        node.name = _TRANSFORM_NODE_NAME
        node.location = (0.0, 0.0)
    elif operation == 5:
        return _write_vector_socket_components(
            _socket(node_group.nodes[_TRANSFORM_NODE_NAME].inputs, "Translation"),
            tuple(definition.translation),
            definition=definition,
            socket_identifier="Translation",
            action_argument="translation",
            source_operation_id=_OPERATION_IDS[operation - 1],
        )
    elif operation == 6:
        return _write_vector_socket_components(
            _socket(node_group.nodes[_TRANSFORM_NODE_NAME].inputs, "Rotation"),
            tuple(definition.rotation),
            definition=definition,
            socket_identifier="Rotation",
            action_argument="rotation",
            source_operation_id=_OPERATION_IDS[operation - 1],
        )
    elif operation == 7:
        return _write_vector_socket_components(
            _socket(node_group.nodes[_TRANSFORM_NODE_NAME].inputs, "Scale"),
            tuple(definition.scale),
            definition=definition,
            socket_identifier="Scale",
            action_argument="scale",
            source_operation_id=_OPERATION_IDS[operation - 1],
        )
    elif operation == 8:
        _add_interface_and_node(
            node_group, "OUTPUT", "NodeGroupOutput", _OUTPUT_NODE_NAME, (320.0, 0.0)
        )
    elif operation == 9:
        input_interface = _interface_socket(node_group, "INPUT")
        node_group.links.new(
            _socket(node_group.nodes[_INPUT_NODE_NAME].outputs, input_interface.identifier),
            _socket(node_group.nodes[_TRANSFORM_NODE_NAME].inputs, "Geometry"),
        )
    elif operation == 10:
        output_interface = _interface_socket(node_group, "OUTPUT")
        node_group.links.new(
            _socket(node_group.nodes[_TRANSFORM_NODE_NAME].outputs, "Geometry"),
            _socket(node_group.nodes[_OUTPUT_NODE_NAME].inputs, output_interface.identifier),
        )
    return ()


def _apply_inverse(operation: int, node_group: Any, definition: Any) -> None:
    if operation == 10:
        _remove_link(node_group, _TRANSFORM_NODE_NAME, _OUTPUT_NODE_NAME)
    elif operation == 9:
        _remove_link(node_group, _INPUT_NODE_NAME, _TRANSFORM_NODE_NAME)
    elif operation == 8:
        node_group.nodes.remove(node_group.nodes[_OUTPUT_NODE_NAME])
        node_group.interface.remove(_interface_socket(node_group, "OUTPUT"))
    elif operation == 7:
        _socket(
            node_group.nodes[_TRANSFORM_NODE_NAME].inputs, "Scale"
        ).default_value = _DEFAULT_SCALE
    elif operation == 6:
        _socket(
            node_group.nodes[_TRANSFORM_NODE_NAME].inputs, "Rotation"
        ).default_value = _DEFAULT_ROTATION
    elif operation == 5:
        _socket(
            node_group.nodes[_TRANSFORM_NODE_NAME].inputs, "Translation"
        ).default_value = _DEFAULT_TRANSLATION
    elif operation == 4:
        node_group.nodes.remove(node_group.nodes[_TRANSFORM_NODE_NAME])
    elif operation == 3:
        node_group.nodes.remove(node_group.nodes[_INPUT_NODE_NAME])
        node_group.interface.remove(_interface_socket(node_group, "INPUT"))


def _recover_transition_or_raise(
    *,
    operation: int,
    direction: str,
    target: Any,
    node_group: Any,
    definition: Any,
    deps: Any,
    expected_stage: int,
    expected_fingerprint: str,
    compensate: Any,
    original_error: Exception,
) -> None:
    """Compensate a failed mutation and prove the exact prior resource state."""

    try:
        _validate_stage(node_group, expected_stage, definition)
        if _fingerprint(target, node_group, deps) == expected_fingerprint:
            return
    except Exception:
        pass
    try:
        compensate(operation, node_group, definition)
        _validate_stage(node_group, expected_stage, definition)
        restored = _fingerprint(target, node_group, deps)
        if restored != expected_fingerprint:
            raise RuntimeError("compensation restored a different resource fingerprint")
    except Exception as recovery_error:
        atomicity_error = GuidedGeometryAtomicityError(
            f"Guided Geometry {direction} operation {operation:02d} failed and "
            "its prior Blender state could not be restored"
        )
        atomicity_error.add_note(f"Original failure: {original_error!r}")
        raise atomicity_error from recovery_error


def _base_resources_absent(target: Any, definition: Any) -> bool:
    node_groups = _bpy().data.node_groups
    group = (
        node_groups.get(definition.node_group_name)
        if hasattr(node_groups, "get")
        else next(
            (
                candidate
                for candidate in node_groups
                if getattr(candidate, "name", None) == definition.node_group_name
            ),
            None,
        )
    )
    return (
        target.modifiers.get(definition.modifier_name) is None
        and group is None
    )


def _observation(
    *,
    operation: int,
    direction: str,
    receipt: Any,
    before_fingerprint: str,
    after_fingerprint: str,
    mutating: bool,
    evidence: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "kind": "guided_geometry_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": direction,
            "operationOrdinal": operation,
            "operationId": _OPERATION_IDS[operation - 1],
            "mutating": mutating,
            "receiptId": receipt.receipt_id,
            "stepId": receipt.step_id,
            "actionName": receipt.action_name,
            "beforeFingerprintSha256": before_fingerprint,
            "afterFingerprintSha256": after_fingerprint,
            "evidence": dict(evidence),
        },
    }


def resume_transform_geometry_transaction(
    *,
    receipt: Any,
    completed_operations: tuple[int, ...],
    fingerprint: str,
    definition: Any,
) -> GuidedGeometryTransaction:
    """Recreate process-local transaction state from an Undo-restored session run."""

    if not completed_operations or completed_operations != tuple(
        range(1, len(completed_operations) + 1)
    ):
        raise ValueError("completed_operations must be a non-empty ordinal prefix")
    if receipt is None:
        raise ValueError("A resumed guided Geometry transaction requires a receipt")
    if not isinstance(fingerprint, str) or len(fingerprint) != 64:
        raise ValueError("A resumed guided Geometry transaction requires a fingerprint")
    return GuidedGeometryTransaction(
        receipt=receipt,
        completed_operations=completed_operations,
        fingerprint=fingerprint,
        definition_fingerprint=_definition_fingerprint(definition),
    )


def verify_transform_geometry_stage(
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
    """Prove that Blender currently matches one exact guided-operation prefix.

    The function deliberately returns only ``True`` or raises.  Native-history
    recovery therefore cannot mistake an incomplete or unverifiable stage for a
    successful Undo.
    """

    if completed_operations != tuple(range(1, len(completed_operations) + 1)):
        raise ValueError("completed_operations must be an ordinal prefix")
    if not isinstance(expected_fingerprint, str) or len(expected_fingerprint) != 64:
        raise ValueError("expected_fingerprint must be a SHA-256 digest")
    deps = _dependencies()
    rebound_receipts: Mapping[str, Any] = receipts
    rebound_partial = partial_receipt
    if rebind_after_native_restore:
        rebound_receipts = deps.rebind_receipts_after_native_restore(receipts)
        if partial_receipt is not None:
            rebound_partial = deps.rebind_receipts_after_native_restore(
                {"guided-partial": partial_receipt}
            )["guided-partial"]

    deps.ensure_receipts_intact(rebound_receipts)
    _target_identity, target = _owned_target(
        rebound_receipts, definition.target_id, deps
    )
    if len(completed_operations) <= 1:
        if rebound_partial is not None:
            raise RuntimeError("The pre-mutation guided stage has a partial receipt")
        if not _base_resources_absent(target, definition):
            raise RuntimeError("Guided Geometry base resources are still present")
        if _fingerprint(target, None, deps) != expected_fingerprint:
            raise RuntimeError("Guided Geometry pre-mutation fingerprint changed")
        return True

    if rebound_partial is None:
        raise RuntimeError("The guided stage partial receipt is unavailable")
    transaction = GuidedGeometryTransaction(
        receipt=rebound_partial,
        completed_operations=completed_operations,
        fingerprint=expected_fingerprint,
        definition_fingerprint=_definition_fingerprint(definition),
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
    return True


def _graph_evidence(node_group: Any | None, stage: int) -> dict[str, Any]:
    if node_group is None:
        return {"stage": stage, "nodeCount": 0, "interfaceSocketCount": 0, "linkCount": 0}
    transform = node_group.nodes.get(_TRANSFORM_NODE_NAME)
    evidence: dict[str, Any] = {
        "stage": stage,
        "nodes": sorted(node.name for node in node_group.nodes),
        "nodeCount": len(node_group.nodes),
        "interfaceSockets": [
            {"name": item.name, "inOut": item.in_out, "socketType": item.socket_type}
            for item in node_group.interface.items_tree
            if item.item_type == "SOCKET"
        ],
        "interfaceSocketCount": sum(
            item.item_type == "SOCKET" for item in node_group.interface.items_tree
        ),
        "linkCount": len(node_group.links),
    }
    if transform is not None:
        evidence.update(
            {
                "translation": list(_vector(_socket(transform.inputs, "Translation"))),
                "rotation": list(_vector(_socket(transform.inputs, "Rotation"))),
                "scale": list(_vector(_socket(transform.inputs, "Scale"))),
            }
        )
    return evidence


def execute_transform_geometry_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction | None = None,
) -> GuidedGeometryOperationResult:
    """Execute exactly one Transform Geometry guide operation."""

    if not isinstance(receipt_id, str) or not receipt_id:
        raise ValueError("receipt_id must be supplied by the caller")
    if action_name != TRANSFORM_GEOMETRY_ACTION:
        raise ValueError(f"Unsupported guided Geometry Nodes action: {action_name}")
    if not 1 <= operation_ordinal <= 11:
        raise ValueError("operation_ordinal must be in [1, 11]")
    deps = _dependencies()
    expected_completed = tuple(range(1, operation_ordinal))
    if transaction is None:
        if operation_ordinal != 1:
            raise RuntimeError("Guided Geometry operation 01 must start the transaction")
        deps.ensure_receipts_intact(receipts)
        target_identity, target = _owned_target(receipts, definition.target_id, deps)
        receipt = _empty_receipt(receipt_id, step_id, action_name, target_identity, deps)
        node_group = None
        before = _fingerprint(target, None, deps)
    else:
        target, node_group = _validate_transaction(
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

    after = None
    rna_control_writes: tuple[dict[str, Any], ...] = ()
    if operation_ordinal == 1:
        deps.ensure_logical_ids_available(
            deps.build_resource_registry(receipts), (definition.node_group_id,)
        )
        deps.ensure_modifier_id_available(receipts, definition.modifier_id)
        deps.ensure_name_available(
            _bpy().data.node_groups, definition.node_group_name, "node group"
        )
        if target.modifiers.get(definition.modifier_name) is not None:
            raise RuntimeError(
                f"Cannot replace existing modifier: {definition.modifier_name}"
            )
    elif operation_ordinal == 2:
        # Re-run the precondition immediately before the first mutation.
        deps.ensure_logical_ids_available(
            deps.build_resource_registry(receipts), (definition.node_group_id,)
        )
        deps.ensure_modifier_id_available(receipts, definition.modifier_id)
        deps.ensure_name_available(
            _bpy().data.node_groups, definition.node_group_name, "node group"
        )
        if target.modifiers.get(definition.modifier_name) is not None:
            raise RuntimeError(
                f"Cannot replace existing modifier: {definition.modifier_name}"
            )
        base_receipt = receipt
        try:
            receipt, node_group = _create_base_resources(
                receipt, target, definition, deps
            )
            _validate_stage(node_group, 2, definition)
            after = _fingerprint(target, node_group, deps)
        except GuidedGeometryAtomicityError:
            raise
        except Exception as error:
            if receipt is not base_receipt:
                try:
                    deps.rollback_receipt(receipt, allow_incomplete=True)
                    receipt = base_receipt
                    node_group = None
                except Exception as recovery_error:
                    raise GuidedGeometryAtomicityError(
                        "Guided Geometry forward operation 02 failed and rollback failed"
                    ) from recovery_error
            if not _base_resources_absent(target, definition):
                raise GuidedGeometryAtomicityError(
                    "Guided Geometry forward operation 02 failed and left base resources"
                ) from error
            if _fingerprint(target, None, deps) != before:
                raise GuidedGeometryAtomicityError(
                    "Guided Geometry forward operation 02 failed and changed the target"
                ) from error
            raise
    elif operation_ordinal <= 10:
        try:
            rna_control_writes = _apply_forward(
                operation_ordinal, node_group, definition
            )
            _validate_stage(node_group, operation_ordinal, definition)
            receipt = _replace_node_signature(receipt, node_group, definition, deps)
            after = _fingerprint(target, node_group, deps)
        except Exception as error:
            _recover_transition_or_raise(
                operation=operation_ordinal,
                direction="forward",
                target=target,
                node_group=node_group,
                definition=definition,
                deps=deps,
                expected_stage=operation_ordinal - 1,
                expected_fingerprint=before,
                compensate=_apply_inverse,
                original_error=error,
            )
            raise
    else:
        _validate_stage(node_group, 10, definition)

    if after is None:
        after = _fingerprint(target, node_group, deps)
    completed = expected_completed + (operation_ordinal,)
    result_transaction = GuidedGeometryTransaction(
        receipt, completed, after, _definition_fingerprint(definition)
    )
    evidence = {
        "completedOperations": list(completed),
        "nodeGroupId": definition.node_group_id if operation_ordinal >= 2 else None,
        "modifierId": definition.modifier_id if operation_ordinal >= 2 else None,
        "completeGraph": operation_ordinal == 11,
        "preconditionsValidated": operation_ordinal == 1,
        "preflightKind": (
            "managed_transform_geometry_resources"
            if operation_ordinal == 1
            else None
        ),
        "preflightTargetId": (
            definition.target_id if operation_ordinal == 1 else None
        ),
        "rnaControlWrites": list(rna_control_writes),
        **_graph_evidence(node_group, min(operation_ordinal, 10)),
    }
    return GuidedGeometryOperationResult(
        result_transaction,
        _observation(
            operation=operation_ordinal,
            direction="forward",
            receipt=receipt,
            before_fingerprint=before,
            after_fingerprint=after,
            mutating=2 <= operation_ordinal <= 10,
            evidence=evidence,
        ),
        before,
        after,
    )


def inverse_transform_geometry_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction,
) -> GuidedGeometryOperationResult:
    """Reverse the transaction's latest operation, refusing non-LIFO requests."""

    if not isinstance(receipt_id, str) or not receipt_id:
        raise ValueError("receipt_id must be supplied by the caller")
    if action_name != TRANSFORM_GEOMETRY_ACTION:
        raise ValueError(f"Unsupported guided Geometry Nodes action: {action_name}")
    if not 1 <= operation_ordinal <= 11:
        raise ValueError("operation_ordinal must be in [1, 11]")
    if (
        not transaction.completed_operations
        or transaction.completed_operations[-1] != operation_ordinal
    ):
        raise RuntimeError("Guided Geometry inverse must target the latest operation")
    deps = _dependencies()
    target, node_group = _validate_transaction(
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
    if operation_ordinal == 2:
        try:
            deps.rollback_receipt(receipt, allow_incomplete=True)
        except Exception as error:
            try:
                _validate_stage(node_group, 2, definition)
                unchanged = _fingerprint(target, node_group, deps) == before
            except Exception:
                unchanged = False
            if not unchanged:
                raise GuidedGeometryAtomicityError(
                    "Guided Geometry inverse operation 02 failed after changing base resources"
                ) from error
            raise
        if not _base_resources_absent(target, definition):
            raise GuidedGeometryAtomicityError(
                "Guided Geometry inverse operation 02 reported success but left base resources"
            )
        receipt = _empty_receipt(
            receipt_id, step_id, action_name, transaction.receipt.anchor, deps
        )
        node_group = None
    elif 3 <= operation_ordinal <= 10:
        try:
            _apply_inverse(operation_ordinal, node_group, definition)
            _validate_stage(node_group, operation_ordinal - 1, definition)
            receipt = _replace_node_signature(receipt, node_group, definition, deps)
        except Exception as error:
            _recover_transition_or_raise(
                operation=operation_ordinal,
                direction="inverse",
                target=target,
                node_group=node_group,
                definition=definition,
                deps=deps,
                expected_stage=operation_ordinal,
                expected_fingerprint=before,
                compensate=_apply_forward,
                original_error=error,
            )
            raise
    elif operation_ordinal not in {1, 11}:
        raise ValueError("operation_ordinal must be in [1, 11]")

    after = _fingerprint(target, node_group, deps)
    completed = transaction.completed_operations[:-1]
    result_transaction = GuidedGeometryTransaction(
        receipt, completed, after, transaction.definition_fingerprint
    )
    return GuidedGeometryOperationResult(
        result_transaction,
        _observation(
            operation=operation_ordinal,
            direction="inverse",
            receipt=receipt,
            before_fingerprint=before,
            after_fingerprint=after,
            mutating=2 <= operation_ordinal <= 10,
            evidence={
                "completedOperations": list(completed),
                **_graph_evidence(
                    node_group,
                    min(completed[-1], 10) if completed else 0,
                ),
            },
        ),
        before,
        after,
    )


__all__ = (
    "GuidedGeometryAtomicityError",
    "GuidedGeometryOperationResult",
    "GuidedGeometryTransaction",
    "TRANSFORM_GEOMETRY_ACTION",
    "execute_transform_geometry_operation",
    "inverse_transform_geometry_operation",
    "resume_transform_geometry_transaction",
)
