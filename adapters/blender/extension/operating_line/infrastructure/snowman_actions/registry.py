"""Allowlisted step-keyed action registry."""

from collections.abc import Callable, Mapping
from typing import Any

from ...application import ActionReceipt
from ...domain import ActionSpec, TaskNode, executable_steps
from .common import COLLECTION_LOGICAL_ID, rollback_receipt, validate_adapter
from .editing import (
    execute_bevel,
    execute_extrude_region,
    execute_geometry_nodes_transform,
    execute_solidify,
    execute_subdivision_surface,
    execute_subdivide,
    execute_triangulate,
    validate_bevel,
    validate_extrude_region,
    validate_geometry_nodes_transform,
    validate_solidify,
    validate_subdivision_surface,
    validate_subdivide,
    validate_triangulate,
)
from .material import execute_materials, validate_palette, validate_single
from .model import (
    execute_geometry,
    legacy_sphere_arguments,
    validate_batch,
    validate_cone,
    validate_cube,
    validate_cylinder,
    validate_icosphere,
    validate_plane,
    validate_torus,
    validate_uv_sphere,
)
from .render import (
    execute_render,
    execute_rig,
    execute_scene,
    validate_render,
    validate_rig,
    validate_scene,
)
from .rigging import (
    execute_armature,
    execute_pose_animation,
    execute_skin_weights,
    validate_armature,
    validate_pose_animation,
    validate_skin_weights,
)

Execute = Callable[[Mapping[str, ActionReceipt]], ActionReceipt]
Rollback = Callable[[ActionReceipt], None]
ActionHandler = Callable[
    [str, ActionSpec, Mapping[str, ActionReceipt], Any],
    ActionReceipt,
]

GEOMETRY_VALIDATORS = {
    "blender.mesh.create_uv_sphere": validate_uv_sphere,
    "blender.mesh.create_icosphere": validate_icosphere,
    "blender.mesh.create_cube": validate_cube,
    "blender.mesh.create_cone": validate_cone,
    "blender.mesh.create_cylinder": validate_cylinder,
    "blender.mesh.create_torus": validate_torus,
    "blender.mesh.create_primitive_batch": validate_batch,
    "blender.mesh.create_plane": validate_plane,
}
MATERIAL_VALIDATORS = {
    "blender.material.create_and_assign": validate_single,
    "blender.material.create_palette_and_assign": validate_palette,
}
LEGACY_SPHERE_ACTIONS = {
    "snowman.body_lower",
    "snowman.body_upper",
    "snowman.head",
}


def _bind_action(
    handler: ActionHandler,
    step_id: str,
    action: ActionSpec,
    definition: Any,
) -> Execute:
    def execute(receipts: Mapping[str, ActionReceipt]) -> ActionReceipt:
        return handler(step_id, action, receipts, definition)

    return execute


def _geometry_resource_ids(primitives: tuple[Any, ...]) -> tuple[str, ...]:
    return tuple(
        logical_id
        for primitive in primitives
        for logical_id in (primitive.logical_id, f"{primitive.logical_id}.mesh")
    )


def build_action_registry(root: TaskNode) -> dict[str, tuple[Execute, Rollback]]:
    actions: dict[str, tuple[Execute, Rollback]] = {}
    planned_resource_ids: set[str] = set()
    collection_reserved = False

    def reserve(step_id: str, logical_ids: tuple[str, ...]) -> None:
        duplicates = planned_resource_ids.intersection(logical_ids)
        if duplicates:
            raise ValueError(
                "Duplicate planned logical resource ID "
                f"on {step_id}: {min(duplicates)}"
            )
        planned_resource_ids.update(logical_ids)

    for step in executable_steps(root):
        action = step.action
        if action is None:
            continue
        validate_adapter(action.adapter_id, action.name)
        arguments = action.arguments
        if action.name in LEGACY_SPHERE_ACTIONS:
            primitives = validate_uv_sphere(legacy_sphere_arguments(action))
        elif action.name in GEOMETRY_VALIDATORS:
            primitives = GEOMETRY_VALIDATORS[action.name](arguments)
        else:
            primitives = None

        if primitives is not None:
            created_ids = _geometry_resource_ids(primitives)
            if not collection_reserved:
                created_ids += (COLLECTION_LOGICAL_ID,)
                collection_reserved = True
            reserve(step.id, created_ids)
            execute = _bind_action(execute_geometry, step.id, action, primitives)
        elif action.name in MATERIAL_VALIDATORS:
            definitions = MATERIAL_VALIDATORS[action.name](arguments)
            reserve(step.id, tuple(item.logical_id for item in definitions))
            execute = _bind_action(execute_materials, step.id, action, definitions)
        elif action.name == "blender.mesh.edit_subdivide":
            definition = validate_subdivide(arguments)
            reserve(step.id, (definition.result_mesh_id,))
            execute = _bind_action(execute_subdivide, step.id, action, definition)
        elif action.name == "blender.mesh.edit_triangulate":
            definition = validate_triangulate(arguments)
            reserve(step.id, (definition.result_mesh_id,))
            execute = _bind_action(execute_triangulate, step.id, action, definition)
        elif action.name == "blender.mesh.edit_extrude_region":
            definition = validate_extrude_region(arguments)
            reserve(step.id, (definition.result_mesh_id,))
            execute = _bind_action(
                execute_extrude_region, step.id, action, definition
            )
        elif action.name == "blender.modifier.add_bevel":
            definition = validate_bevel(arguments)
            reserve(step.id, (definition.modifier_id,))
            execute = _bind_action(execute_bevel, step.id, action, definition)
        elif action.name == "blender.modifier.add_solidify":
            definition = validate_solidify(arguments)
            reserve(step.id, (definition.modifier_id,))
            execute = _bind_action(execute_solidify, step.id, action, definition)
        elif action.name == "blender.modifier.add_subdivision_surface":
            definition = validate_subdivision_surface(arguments)
            reserve(step.id, (definition.modifier_id,))
            execute = _bind_action(
                execute_subdivision_surface, step.id, action, definition
            )
        elif action.name == "blender.geometry_nodes.create_transform":
            definition = validate_geometry_nodes_transform(arguments)
            reserve(
                step.id,
                (definition.modifier_id, definition.node_group_id),
            )
            execute = _bind_action(
                execute_geometry_nodes_transform,
                step.id,
                action,
                definition,
            )
        elif action.name == "blender.rig.create_armature":
            definition = validate_armature(arguments)
            reserve(
                step.id,
                (definition.logical_id, f"{definition.logical_id}.data"),
            )
            execute = _bind_action(execute_armature, step.id, action, definition)
        elif action.name == "blender.animation.create_pose_keyframes":
            definition = validate_pose_animation(arguments)
            reserve(step.id, (definition.logical_id,))
            execute = _bind_action(
                execute_pose_animation,
                step.id,
                action,
                definition,
            )
        elif action.name == "blender.rig.bind_skin_weights":
            definition = validate_skin_weights(arguments)
            execute = _bind_action(
                execute_skin_weights,
                step.id,
                action,
                definition,
            )
        elif action.name == "blender.render_scene.create":
            definition = validate_scene(arguments)
            reserve(step.id, (definition.scene_id, definition.world_id))
            execute = _bind_action(execute_scene, step.id, action, definition)
        elif action.name == "blender.render_rig.create":
            definition = validate_rig(arguments)
            reserve(
                step.id,
                tuple(
                    logical_id
                    for resource_id in (
                        *(item.logical_id for item in definition.lights),
                        definition.camera.logical_id,
                    )
                    for logical_id in (resource_id, f"{resource_id}.data")
                ),
            )
            execute = _bind_action(execute_rig, step.id, action, definition)
        elif action.name == "blender.render.execute_preview":
            definition = validate_render(arguments)
            reserve(step.id, (definition.render_id,))
            execute = _bind_action(execute_render, step.id, action, definition)
        else:  # pragma: no cover - validate_adapter is the boundary
            raise ValueError(f"Unsupported Blender action: {action.name}")
        actions[step.id] = (execute, rollback_receipt)
    return actions
