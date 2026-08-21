"""Fail-closed allowlist for action-level MCP execution in Blender."""

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
    "is_action_level_mcp_action",
    "is_action_level_mcp_recipe",
    "is_action_level_mcp_primitive",
    "is_action_level_mcp_primitive_recipe",
)
