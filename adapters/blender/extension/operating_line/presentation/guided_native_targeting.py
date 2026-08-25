"""Receipt-bound native RNA targets for Geometry Nodes guided controls."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .guided_control_dock import (
    LIGHT_TRAILS_ACTION_NAME,
    LIGHT_TRAILS_RNA_WRITE_TARGETS,
    TRANSFORM_GEOMETRY_ACTION_NAME,
)


_SOCKET_TARGETS = {
    TRANSFORM_GEOMETRY_ACTION_NAME: {
        "translation": (
            (
                None,
                "GeometryNodeTransform",
                "Translation",
                (0, 1, 2),
                ("X", "Y", "Z"),
            ),
        ),
        "rotation": (
            (
                None,
                "GeometryNodeTransform",
                "Rotation",
                (0, 1, 2),
                ("X", "Y", "Z"),
            ),
        ),
        "scale": (
            (None, "GeometryNodeTransform", "Scale", (0, 1, 2), ("X", "Y", "Z")),
        ),
    },
    LIGHT_TRAILS_ACTION_NAME: {
        argument_name: tuple(
            (
                node_name,
                node_type,
                socket_identifier,
                (component_index,),
                (component_label,),
            )
            for (
                node_name,
                node_type,
                socket_identifier,
                component_index,
                component_label,
                _projection,
            ) in targets
        )
        for argument_name, targets in LIGHT_TRAILS_RNA_WRITE_TARGETS.items()
    },
}


@dataclass(frozen=True, slots=True)
class GuidedNativeRnaTarget:
    """One visible, receipt-bound RNA property in the Node Editor."""

    status: str
    region: Any = None
    node: Any = None
    data: Any = None
    property_name: str | None = None
    component_indexes: tuple[int, ...] = ()
    component_labels: tuple[str, ...] = ()
    detail: str | None = None

    @property
    def ready(self) -> bool:
        return self.status == "ready"


def _result(status: str, detail: str) -> GuidedNativeRnaTarget:
    return GuidedNativeRnaTarget(status=status, detail=detail)


def _window_region(context: Any) -> Any | None:
    region = getattr(context, "region", None)
    if getattr(region, "type", None) == "WINDOW":
        return region
    area = getattr(context, "area", None)
    if area is None:
        return None
    try:
        matches = tuple(
            candidate
            for candidate in area.regions
            if getattr(candidate, "type", None) == "WINDOW"
        )
    except (AttributeError, RuntimeError, TypeError):
        return None
    return matches[0] if len(matches) == 1 else None


def resolve_guided_geometry_native_target(
    session: Any,
    step: Any,
    context: Any,
    argument_name: str,
    *,
    write_order: int = 1,
    resolve_resource: Callable[[Any], Any],
) -> GuidedNativeRnaTarget:
    """Resolve a native socket value without ever selecting an unrelated node tree."""

    action = getattr(step, "action", None)
    arguments = getattr(action, "arguments", None)
    action_name = getattr(action, "name", None)
    target_definitions = _SOCKET_TARGETS.get(action_name, {}).get(argument_name)
    if target_definitions is None:
        return _result("unsupported_parameter", "Unsupported guided node parameter")
    if (
        isinstance(write_order, bool)
        or not isinstance(write_order, int)
        or not 1 <= write_order <= len(target_definitions)
    ):
        return _result(
            "invalid_binding", "The guided RNA write order is outside its exact target set"
        )
    (
        node_name,
        node_type,
        socket_identifier,
        component_indexes,
        component_labels,
    ) = target_definitions[write_order - 1]
    if (
        step is None
        or action is None
        or action_name not in _SOCKET_TARGETS
        or not isinstance(arguments, dict)
    ):
        return _result(
            "wrong_leaf",
            "The current leaf is not a reviewed Geometry Nodes recipe",
        )
    node_group_id = arguments.get("nodeGroupId")
    node_group_name = arguments.get("nodeGroupName")
    if not isinstance(node_group_id, str) or not isinstance(node_group_name, str):
        return _result("invalid_binding", "The accepted leaf has no node-group binding")
    try:
        receipt_lookup = getattr(session, "receipt_for_step", None)
        receipt = (
            receipt_lookup(step.id)
            if callable(receipt_lookup)
            else session.receipts.get(step.id)
        )
    except (AttributeError, RuntimeError, TypeError):
        receipt = None
    if receipt is None:
        return _result(
            "receipt_unavailable",
            "Native targeting requires a current receipt-bound recovery leaf",
        )
    try:
        identities = tuple(
            identity
            for identity in receipt.created
            if getattr(identity, "logical_id", None) == node_group_id
        )
    except (AttributeError, RuntimeError, TypeError):
        return _result("invalid_receipt", "The managed receipt is incomplete")
    if (
        getattr(receipt, "step_id", None) != step.id
        or getattr(receipt, "action_name", None) != action.name
        or len(identities) != 1
    ):
        return _result("invalid_receipt", "The managed receipt does not bind this leaf")
    identity = identities[0]
    if (
        getattr(identity, "resource_type", None) != "NODE_GROUP"
        or getattr(identity, "display_name", None) != node_group_name
        or getattr(identity, "receipt_token", None) != getattr(receipt, "receipt_id", None)
        or getattr(identity, "step_id", None) != step.id
        or getattr(identity, "action_name", None) != action.name
    ):
        return _result("invalid_receipt", "The node-group identity is not receipt-bound")
    try:
        node_tree = resolve_resource(identity)
    except (KeyError, RuntimeError, TypeError, ValueError):
        return _result("resource_unavailable", "The managed node group is unavailable")
    space = getattr(context, "space_data", None)
    if (
        node_tree is None
        or node_tree is not getattr(space, "edit_tree", None)
        or getattr(node_tree, "name", None) != node_group_name
        or getattr(node_tree, "bl_idname", None) != "GeometryNodeTree"
    ):
        return _result(
            "wrong_editor",
            "Open the receipt-bound Geometry Nodes tree in this editor first",
        )
    try:
        nodes = tuple(
            node
            for node in node_tree.nodes
            if (
                (node_name is None or getattr(node, "name", None) == node_name)
                and (node_type is None or getattr(node, "bl_idname", None) == node_type)
            )
        )
    except (AttributeError, RuntimeError, TypeError):
        return _result("target_unavailable", "Guided Geometry Nodes target is unavailable")
    if len(nodes) != 1:
        return _result("target_ambiguous", "Guided Geometry Nodes target is not unique")
    try:
        sockets = tuple(
            socket
            for socket in nodes[0].inputs
            if getattr(socket, "identifier", None) == socket_identifier
        )
    except (AttributeError, RuntimeError, TypeError):
        return _result("target_unavailable", "Guided Geometry Nodes inputs are unavailable")
    if len(sockets) != 1:
        return _result("target_ambiguous", f"{socket_identifier} socket is not unique")
    region = _window_region(context)
    if region is None:
        return _result("wrong_region", "The Node Editor WINDOW region is unavailable")
    return GuidedNativeRnaTarget(
        status="ready",
        region=region,
        node=nodes[0],
        data=sockets[0],
        property_name="default_value",
        component_indexes=component_indexes,
        component_labels=component_labels,
    )


__all__ = (
    "GuidedNativeRnaTarget",
    "resolve_guided_geometry_native_target",
)
