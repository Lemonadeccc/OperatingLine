"""Locale-independent access to required shader nodes and sockets."""

from typing import Any


def find_unique_node(node_tree: Any, bl_idname: str) -> Any | None:
    """Return the sole node with ``bl_idname``, independent of its display name."""

    if node_tree is None:
        return None
    matches = tuple(
        node for node in node_tree.nodes if node.bl_idname == bl_idname
    )
    return matches[0] if len(matches) == 1 else None


def require_unique_node(node_tree: Any, bl_idname: str, label: str) -> Any:
    """Return one required node or fail without mutating the node tree."""

    if node_tree is None:
        raise RuntimeError(f"{label} has no node tree")
    matches = tuple(
        node for node in node_tree.nodes if node.bl_idname == bl_idname
    )
    if len(matches) != 1:
        raise RuntimeError(
            f"{label} must contain exactly one {bl_idname} node; "
            f"found {len(matches)}"
        )
    return matches[0]


def find_unique_input(node: Any, identifier: str) -> Any | None:
    """Return the sole input with a stable RNA identifier."""

    matches = tuple(
        socket for socket in node.inputs if socket.identifier == identifier
    )
    return matches[0] if len(matches) == 1 else None


def require_unique_input(node: Any, identifier: str, label: str) -> Any:
    """Return one required input or fail without falling back to a display name."""

    matches = tuple(
        socket for socket in node.inputs if socket.identifier == identifier
    )
    if len(matches) != 1:
        raise RuntimeError(
            f"{label} must contain exactly one {identifier!r} input; "
            f"found {len(matches)}"
        )
    return matches[0]
