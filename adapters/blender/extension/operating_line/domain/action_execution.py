"""Fail-closed allowlist for action-level MCP execution in Blender."""

from collections.abc import Mapping, Sequence

ACTION_LEVEL_MCP_PRIMITIVE_ACTIONS = frozenset(
    {
        "blender.mesh.create_uv_sphere",
        "blender.mesh.create_icosphere",
        "blender.mesh.create_cube",
        "blender.mesh.create_plane",
        "blender.mesh.create_torus",
        "blender.mesh.create_cone",
        "blender.mesh.create_cylinder",
    }
)

ACTION_LEVEL_MCP_PRIMITIVE_RECIPES = frozenset(
    f"{action_name}.native"
    for action_name in ACTION_LEVEL_MCP_PRIMITIVE_ACTIONS
)

ACTION_LEVEL_MCP_ACTIONS = ACTION_LEVEL_MCP_PRIMITIVE_ACTIONS | {
    "blender.modifier.add_mirror"
}
ACTION_LEVEL_MCP_RECIPES = ACTION_LEVEL_MCP_PRIMITIVE_RECIPES | {
    "blender.modifier.add_mirror.semantic"
}

POKE_FACES_COMPOUND_RECIPES = {
    "forward": ("enter_edit", "poke", "exit_edit"),
    "back": ("enter_edit", "native_undo_once", "exit_edit"),
    "redo": ("enter_edit", "native_redo_once", "exit_edit"),
}

_POKE_HISTORY_PROOF_FIELDS = frozenset(
    {
        "kind",
        "modeScope",
        "objectModeUndoRedoClaim",
        "editBaselineIdentitySha256",
        "editFinalIdentitySha256",
        "objectPointerSha256",
        "meshPointerSha256",
        "meshDatablockSha256",
        "baselineTopologySha256",
        "finalTopologySha256",
        "baselineSelectionSha256",
        "finalSelectionSha256",
        "historyHeadBeforeSha256",
        "historyHeadAfterSha256",
        "checkpointSha256",
        "journalHeadSha256",
    }
)


def _is_sha256(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def validate_poke_faces_compound_leaves(
    recipe_kind: object,
    leaves: object,
) -> bool:
    """Accept only Enter/Poke-or-history/Exit with proof owned by the middle leaf."""

    expected = POKE_FACES_COMPOUND_RECIPES.get(recipe_kind)
    if (
        expected is None
        or not isinstance(leaves, Sequence)
        or isinstance(leaves, (str, bytes))
        or len(leaves) != 3
    ):
        return False
    for index, (leaf, expected_kind) in enumerate(zip(leaves, expected, strict=True)):
        if not isinstance(leaf, Mapping) or leaf.get("kind") != expected_kind:
            return False
        middle = index == 1
        expected_count = 1 if middle and recipe_kind in {"back", "redo"} else 0
        if leaf.get("nativeUndoRedoOperationCount") != expected_count:
            return False
        if leaf.get("modelChanging") is not middle:
            return False
        proof = leaf.get("historyProof")
        if (proof is not None) is not middle:
            return False
        if proof is not None:
            if (
                not isinstance(proof, Mapping)
                or frozenset(proof) != _POKE_HISTORY_PROOF_FIELDS
                or proof.get("modeScope") != "edit_middle_only"
                or proof.get("objectModeUndoRedoClaim") is not False
                or proof.get("kind")
                != {
                    "forward": "poke_native_checkpoint",
                    "back": "native_undo_once",
                    "redo": "native_redo_once",
                }[recipe_kind]
                or any(
                    not _is_sha256(proof.get(field))
                    for field in _POKE_HISTORY_PROOF_FIELDS
                    - {"kind", "modeScope", "objectModeUndoRedoClaim"}
                )
            ):
                return False
    return True


def is_action_level_mcp_primitive(action_name: object) -> bool:
    """Return whether ``action_name`` is one exact approved primitive action."""

    return (
        isinstance(action_name, str)
        and action_name in ACTION_LEVEL_MCP_PRIMITIVE_ACTIONS
    )


def is_action_level_mcp_primitive_recipe(recipe_id: object) -> bool:
    """Return whether ``recipe_id`` is one exact approved native recipe."""

    return (
        isinstance(recipe_id, str)
        and recipe_id in ACTION_LEVEL_MCP_PRIMITIVE_RECIPES
    )


def is_action_level_mcp_action(action_name: object) -> bool:
    """Return whether ``action_name`` is one exact approved MCP action."""

    return isinstance(action_name, str) and action_name in ACTION_LEVEL_MCP_ACTIONS


def is_action_level_mcp_recipe(recipe_id: object) -> bool:
    """Return whether ``recipe_id`` is one exact approved MCP recipe."""

    return isinstance(recipe_id, str) and recipe_id in ACTION_LEVEL_MCP_RECIPES


__all__ = (
    "ACTION_LEVEL_MCP_PRIMITIVE_ACTIONS",
    "ACTION_LEVEL_MCP_PRIMITIVE_RECIPES",
    "ACTION_LEVEL_MCP_ACTIONS",
    "ACTION_LEVEL_MCP_RECIPES",
    "POKE_FACES_COMPOUND_RECIPES",
    "is_action_level_mcp_action",
    "is_action_level_mcp_recipe",
    "is_action_level_mcp_primitive",
    "is_action_level_mcp_primitive_recipe",
    "validate_poke_faces_compound_leaves",
)
