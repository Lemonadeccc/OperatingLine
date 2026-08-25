"""Operators exposing accepted-plan guidance and proposal review use cases."""

from copy import deepcopy
from dataclasses import replace
import json
import math
from types import SimpleNamespace
import bpy

from ..application import ObservationGateError
from ..application.guided_geometry_command import (
    GuidedGeometryCommandFailure,
    GuidedGeometryCommandRejected,
    GuidedGeometryCommandServices,
    GuidedGeometryHistoryPort,
    execute_guided_geometry_operation,
)
from ..application.provider_handoff import PROVIDER_AUTHORITY_UNAVAILABLE
from ..infrastructure import (
    cancel_native_history,
    clear_native_rna_badge,
    commit_native_history,
    disable_overlay,
    enable_overlay,
    overlay_enabled,
    prepare_native_history,
    prepared_native_history_changed,
    remember_native_rna_badge,
    remove_factory_startup_objects,
    resolve_resource,
    try_activate_native_rna_button,
)
from .guided_control_dock import (
    ARMATURE_ACTION_NAME,
    ARMATURE_RECIPE_ID,
    BEVEL_MODIFIER_ACTION_NAME,
    BEVEL_MODIFIER_RECIPE_ID,
    EDIT_BEVEL_ACTION_NAME,
    EDIT_BEVEL_RECIPE_ID,
    EDIT_EXTRUDE_REGION_ACTION_NAME,
    EDIT_EXTRUDE_REGION_RECIPE_ID,
    EDIT_INSET_ACTION_NAME,
    EDIT_INSET_RECIPE_ID,
    EDIT_TRIANGULATE_ACTION_NAME,
    EDIT_TRIANGULATE_RECIPE_ID,
    EDIT_POKE_ACTION_NAME,
    EDIT_POKE_RECIPE_ID,
    LIGHT_TRAILS_ACTION_NAME,
    LIGHT_TRAILS_RECIPE_ID,
    MATERIAL_PALETTE_ACTION_NAME,
    MATERIAL_PALETTE_RECIPE_ID,
    MIRROR_ACTION_NAME,
    MIRROR_RECIPE_ID,
    POSE_ANIMATION_ACTION_NAME,
    POSE_ANIMATION_RECIPE_ID,
    SKIN_WEIGHTS_ACTION_NAME,
    SKIN_WEIGHTS_RECIPE_ID,
    SOLIDIFY_ACTION_NAME,
    SOLIDIFY_RECIPE_ID,
    SUBDIVISION_SURFACE_ACTION_NAME,
    SUBDIVISION_SURFACE_RECIPE_ID,
    TRANSFORM_GEOMETRY_ACTION_NAME,
    TRANSFORM_GEOMETRY_RECIPE_ID,
    guided_control_dock_model,
)

from .guided_native_targeting import resolve_guided_geometry_native_target
from .native_menu_guidance import (
    disable_native_menu_guidance,
    enable_native_menu_guidance,
    focus_next_leaf_operation,
    focus_previous_leaf_operation,
    guided_menu_action_matches,
    interaction_guidance_snapshot,
    leaf_guidance_snapshot,
    native_menu_snapshot,
    refresh_native_menu_guidance,
    retry_leaf_operation,
)

SINGLE_MATERIAL_ACTION_NAME = "blender.material.create_and_assign"
SINGLE_MATERIAL_RECIPE_ID = "blender.material.create_and_assign.semantic"


def _session():
    from .. import get_session

    return get_session()


def _companion():
    from .. import get_companion

    return get_companion()


def execute_transform_geometry_operation(**kwargs):
    from ..infrastructure.guided_geometry_operations import (
        execute_transform_geometry_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_transform_geometry_operation(**kwargs):
    from ..infrastructure.guided_geometry_operations import (
        inverse_transform_geometry_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_transform_geometry_transaction(**kwargs):
    from ..infrastructure.guided_geometry_operations import (
        resume_transform_geometry_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_transform_geometry_stage(**kwargs):
    from ..infrastructure.guided_geometry_operations import (
        verify_transform_geometry_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_light_trails_operation(**kwargs):
    from ..infrastructure.guided_light_trails_operations import (
        execute_light_trails_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_light_trails_operation(**kwargs):
    from ..infrastructure.guided_light_trails_operations import (
        inverse_light_trails_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_light_trails_transaction(**kwargs):
    from ..infrastructure.guided_light_trails_operations import (
        resume_light_trails_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_light_trails_stage(**kwargs):
    from ..infrastructure.guided_light_trails_operations import (
        verify_light_trails_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_pose_animation_operation(**kwargs):
    from ..infrastructure.guided_pose_animation_operations import (
        execute_pose_animation_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_pose_animation_operation(**kwargs):
    from ..infrastructure.guided_pose_animation_operations import (
        inverse_pose_animation_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_pose_animation_transaction(**kwargs):
    from ..infrastructure.guided_pose_animation_operations import (
        resume_pose_animation_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_pose_animation_stage(**kwargs):
    from ..infrastructure.guided_pose_animation_operations import (
        verify_pose_animation_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_armature_operation(**kwargs):
    from ..infrastructure.guided_armature_operations import (
        execute_armature_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_armature_operation(**kwargs):
    from ..infrastructure.guided_armature_operations import (
        inverse_armature_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_armature_transaction(**kwargs):
    from ..infrastructure.guided_armature_operations import (
        resume_armature_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_armature_stage(**kwargs):
    from ..infrastructure.guided_armature_operations import (
        verify_armature_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_skin_weights_operation(**kwargs):
    from ..infrastructure.guided_skin_weights_operations import (
        execute_skin_weights_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_skin_weights_operation(**kwargs):
    from ..infrastructure.guided_skin_weights_operations import (
        inverse_skin_weights_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_skin_weights_transaction(**kwargs):
    from ..infrastructure.guided_skin_weights_operations import (
        resume_skin_weights_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_skin_weights_stage(**kwargs):
    from ..infrastructure.guided_skin_weights_operations import (
        verify_skin_weights_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_solidify_operation(**kwargs):
    from ..infrastructure.guided_solidify_operations import (
        execute_solidify_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_solidify_operation(**kwargs):
    from ..infrastructure.guided_solidify_operations import (
        inverse_solidify_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_solidify_transaction(**kwargs):
    from ..infrastructure.guided_solidify_operations import (
        resume_solidify_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_solidify_stage(**kwargs):
    from ..infrastructure.guided_solidify_operations import (
        verify_solidify_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_bevel_modifier_operation(**kwargs):
    from ..infrastructure.guided_bevel_modifier_operations import (
        execute_bevel_modifier_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_bevel_modifier_operation(**kwargs):
    from ..infrastructure.guided_bevel_modifier_operations import (
        inverse_bevel_modifier_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_bevel_modifier_transaction(**kwargs):
    from ..infrastructure.guided_bevel_modifier_operations import (
        resume_bevel_modifier_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_bevel_modifier_stage(**kwargs):
    from ..infrastructure.guided_bevel_modifier_operations import (
        verify_bevel_modifier_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_single_material_operation(**kwargs):
    from ..infrastructure.guided_single_material_operations import (
        execute_single_material_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_single_material_operation(**kwargs):
    from ..infrastructure.guided_single_material_operations import (
        inverse_single_material_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_single_material_transaction(**kwargs):
    from ..infrastructure.guided_single_material_operations import (
        resume_single_material_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_single_material_stage(**kwargs):
    from ..infrastructure.guided_single_material_operations import (
        verify_single_material_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_material_palette_operation(**kwargs):
    from ..infrastructure.guided_material_palette_operations import (
        execute_material_palette_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_material_palette_operation(**kwargs):
    from ..infrastructure.guided_material_palette_operations import (
        inverse_material_palette_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_material_palette_transaction(**kwargs):
    from ..infrastructure.guided_material_palette_operations import (
        resume_material_palette_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_material_palette_stage(**kwargs):
    from ..infrastructure.guided_material_palette_operations import (
        verify_material_palette_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_subdivision_surface_operation(**kwargs):
    from ..infrastructure.guided_subdivision_surface_operations import (
        execute_subdivision_surface_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_subdivision_surface_operation(**kwargs):
    from ..infrastructure.guided_subdivision_surface_operations import (
        inverse_subdivision_surface_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_subdivision_surface_transaction(**kwargs):
    from ..infrastructure.guided_subdivision_surface_operations import (
        resume_subdivision_surface_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_subdivision_surface_stage(**kwargs):
    from ..infrastructure.guided_subdivision_surface_operations import (
        verify_subdivision_surface_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_edit_bevel_operation(**kwargs):
    from ..infrastructure.guided_edit_bevel_operations import (
        execute_edit_bevel_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_edit_bevel_operation(**kwargs):
    from ..infrastructure.guided_edit_bevel_operations import (
        inverse_edit_bevel_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_edit_bevel_transaction(**kwargs):
    from ..infrastructure.guided_edit_bevel_operations import (
        resume_edit_bevel_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_edit_bevel_stage(**kwargs):
    from ..infrastructure.guided_edit_bevel_operations import (
        verify_edit_bevel_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_edit_inset_operation(**kwargs):
    from ..infrastructure.guided_edit_inset_operations import (
        execute_edit_inset_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_edit_inset_operation(**kwargs):
    from ..infrastructure.guided_edit_inset_operations import (
        inverse_edit_inset_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_edit_inset_transaction(**kwargs):
    from ..infrastructure.guided_edit_inset_operations import (
        resume_edit_inset_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_edit_inset_stage(**kwargs):
    from ..infrastructure.guided_edit_inset_operations import (
        verify_edit_inset_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_edit_triangulate_operation(**kwargs):
    from ..infrastructure.guided_edit_triangulate_operations import (
        execute_edit_triangulate_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_edit_triangulate_operation(**kwargs):
    from ..infrastructure.guided_edit_triangulate_operations import (
        inverse_edit_triangulate_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_edit_triangulate_transaction(**kwargs):
    from ..infrastructure.guided_edit_triangulate_operations import (
        resume_edit_triangulate_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_edit_triangulate_stage(**kwargs):
    from ..infrastructure.guided_edit_triangulate_operations import (
        verify_edit_triangulate_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_edit_extrude_region_operation(**kwargs):
    from ..infrastructure.guided_edit_extrude_region_operations import (
        execute_edit_extrude_region_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_edit_extrude_region_operation(**kwargs):
    from ..infrastructure.guided_edit_extrude_region_operations import (
        inverse_edit_extrude_region_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_edit_extrude_region_transaction(**kwargs):
    from ..infrastructure.guided_edit_extrude_region_operations import (
        resume_edit_extrude_region_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_edit_extrude_region_stage(**kwargs):
    from ..infrastructure.guided_edit_extrude_region_operations import (
        verify_edit_extrude_region_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_edit_poke_operation(**kwargs):
    from ..infrastructure.guided_edit_poke_operations import (
        execute_edit_poke_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_edit_poke_operation(**kwargs):
    from ..infrastructure.guided_edit_poke_operations import (
        inverse_edit_poke_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_edit_poke_transaction(**kwargs):
    from ..infrastructure.guided_edit_poke_operations import (
        resume_edit_poke_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_edit_poke_stage(**kwargs):
    from ..infrastructure.guided_edit_poke_operations import (
        verify_edit_poke_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def execute_mirror_operation(**kwargs):
    from ..infrastructure.guided_mirror_operations import (
        execute_mirror_operation as execute_operation,
    )

    return execute_operation(**kwargs)


def inverse_mirror_operation(**kwargs):
    from ..infrastructure.guided_mirror_operations import (
        inverse_mirror_operation as inverse_operation,
    )

    return inverse_operation(**kwargs)


def resume_mirror_transaction(**kwargs):
    from ..infrastructure.guided_mirror_operations import (
        resume_mirror_transaction as resume_transaction,
    )

    return resume_transaction(**kwargs)


def verify_mirror_stage(**kwargs):
    from ..infrastructure.guided_mirror_operations import (
        verify_mirror_stage as verify_stage,
    )

    return verify_stage(**kwargs)


def is_guided_geometry_atomicity_error(error) -> bool:
    if type(error).__name__ != "GuidedGeometryAtomicityError":
        return False
    from ..infrastructure.guided_geometry_operations import (
        GuidedGeometryAtomicityError,
    )

    return isinstance(error, GuidedGeometryAtomicityError)


def is_action_atomicity_error(error) -> bool:
    if type(error).__name__ != "ActionAtomicityError":
        return False
    from ..infrastructure.snowman_actions.common import ActionAtomicityError

    return isinstance(error, ActionAtomicityError)


def is_action_host_state_restored_error(error) -> bool:
    from ..infrastructure.snowman_actions.common import action_host_state_restored

    return action_host_state_restored(error)


def is_native_undo_required_error(error) -> bool:
    if type(error).__name__ != "NativeUndoRequiredError":
        return False
    from ..infrastructure.native_history import NativeUndoRequiredError

    return isinstance(error, NativeUndoRequiredError)


def native_history_requires_native_undo() -> bool:
    from ..infrastructure.native_history import (
        native_history_requires_native_undo as requires_native_undo,
    )

    return requires_native_undo()


def _native_history_recovery(snapshot, recovery_probe):
    from ..infrastructure.native_history import NativeHistoryRecovery

    return NativeHistoryRecovery(snapshot, recovery_probe)


def validate_geometry_nodes_transform(arguments):
    from ..infrastructure.snowman_actions.editing import (
        validate_geometry_nodes_transform as validate_definition,
    )

    return validate_definition(arguments)


def validate_geometry_nodes_light_trails(arguments):
    from ..infrastructure.snowman_actions.editing import (
        validate_geometry_nodes_light_trails as validate_definition,
    )

    return validate_definition(arguments)


def validate_pose_animation(arguments):
    from ..infrastructure.snowman_actions.rigging import (
        validate_pose_animation as validate_definition,
    )

    return validate_definition(arguments)


def validate_armature(arguments):
    from ..infrastructure.snowman_actions.rigging import (
        validate_armature as validate_definition,
    )

    return validate_definition(arguments)


def validate_skin_weights(arguments):
    from ..infrastructure.snowman_actions.rigging import (
        validate_skin_weights as validate_definition,
    )

    return validate_definition(arguments)


def validate_solidify(arguments):
    from ..infrastructure.snowman_actions.editing import (
        validate_solidify as validate_definition,
    )

    return validate_definition(arguments)


def validate_bevel_modifier(arguments):
    from ..infrastructure.snowman_actions.editing import (
        validate_bevel as validate_definition,
    )

    return validate_definition(arguments)


def validate_single_material(arguments):
    from ..infrastructure.snowman_actions.material import (
        validate_single_definition as validate_definition,
    )

    return validate_definition(arguments)


def validate_material_palette(arguments):
    from ..infrastructure.snowman_actions.material import (
        validate_palette as validate_definition,
    )

    return validate_definition(arguments)


def validate_subdivision_surface(arguments):
    from ..infrastructure.snowman_actions.editing import (
        validate_subdivision_surface as validate_definition,
    )

    return validate_definition(arguments)


def validate_edit_bevel(arguments):
    from ..infrastructure.snowman_actions.editing import (
        validate_edit_bevel_edges as validate_definition,
    )

    return validate_definition(arguments)


def validate_edit_inset(arguments):
    from ..infrastructure.snowman_actions.editing import (
        validate_edit_inset_faces as validate_definition,
    )

    return validate_definition(arguments)


def validate_edit_triangulate(arguments):
    from ..infrastructure.snowman_actions.editing import (
        validate_triangulate as validate_definition,
    )

    return validate_definition(arguments)


def validate_edit_extrude_region(arguments):
    from ..infrastructure.snowman_actions.editing import (
        validate_extrude_region as validate_definition,
    )

    return validate_definition(arguments)


def validate_edit_poke(arguments):
    from ..infrastructure.snowman_actions.editing import (
        validate_edit_poke_faces as validate_definition,
    )

    return validate_definition(arguments)


def validate_mirror(arguments):
    from ..infrastructure.snowman_actions.editing import (
        validate_mirror as validate_definition,
    )

    return validate_definition(arguments)


def _guided_geometry_execution_profile(action_name: str):
    if action_name == TRANSFORM_GEOMETRY_ACTION_NAME:
        return SimpleNamespace(
            action_name=TRANSFORM_GEOMETRY_ACTION_NAME,
            recipe_id=TRANSFORM_GEOMETRY_RECIPE_ID,
            validate_definition=validate_geometry_nodes_transform,
            execute_operation=execute_transform_geometry_operation,
            inverse_operation=inverse_transform_geometry_operation,
            resume_transaction=resume_transform_geometry_transaction,
            verify_stage=verify_transform_geometry_stage,
        )
    if action_name == LIGHT_TRAILS_ACTION_NAME:
        return SimpleNamespace(
            action_name=LIGHT_TRAILS_ACTION_NAME,
            recipe_id=LIGHT_TRAILS_RECIPE_ID,
            validate_definition=validate_geometry_nodes_light_trails,
            execute_operation=execute_light_trails_operation,
            inverse_operation=inverse_light_trails_operation,
            resume_transaction=resume_light_trails_transaction,
            verify_stage=verify_light_trails_stage,
        )
    if action_name == POSE_ANIMATION_ACTION_NAME:
        return SimpleNamespace(
            action_name=POSE_ANIMATION_ACTION_NAME,
            recipe_id=POSE_ANIMATION_RECIPE_ID,
            validate_definition=validate_pose_animation,
            execute_operation=execute_pose_animation_operation,
            inverse_operation=inverse_pose_animation_operation,
            resume_transaction=resume_pose_animation_transaction,
            verify_stage=verify_pose_animation_stage,
        )
    if action_name == ARMATURE_ACTION_NAME:
        return SimpleNamespace(
            action_name=ARMATURE_ACTION_NAME,
            recipe_id=ARMATURE_RECIPE_ID,
            validate_definition=validate_armature,
            execute_operation=execute_armature_operation,
            inverse_operation=inverse_armature_operation,
            resume_transaction=resume_armature_transaction,
            verify_stage=verify_armature_stage,
        )
    if action_name == SKIN_WEIGHTS_ACTION_NAME:
        return SimpleNamespace(
            action_name=SKIN_WEIGHTS_ACTION_NAME,
            recipe_id=SKIN_WEIGHTS_RECIPE_ID,
            validate_definition=validate_skin_weights,
            execute_operation=execute_skin_weights_operation,
            inverse_operation=inverse_skin_weights_operation,
            resume_transaction=resume_skin_weights_transaction,
            verify_stage=verify_skin_weights_stage,
        )
    if action_name == SOLIDIFY_ACTION_NAME:
        return SimpleNamespace(
            action_name=SOLIDIFY_ACTION_NAME,
            recipe_id=SOLIDIFY_RECIPE_ID,
            validate_definition=validate_solidify,
            execute_operation=execute_solidify_operation,
            inverse_operation=inverse_solidify_operation,
            resume_transaction=resume_solidify_transaction,
            verify_stage=verify_solidify_stage,
        )
    if action_name == BEVEL_MODIFIER_ACTION_NAME:
        return SimpleNamespace(
            action_name=BEVEL_MODIFIER_ACTION_NAME,
            recipe_id=BEVEL_MODIFIER_RECIPE_ID,
            validate_definition=validate_bevel_modifier,
            execute_operation=execute_bevel_modifier_operation,
            inverse_operation=inverse_bevel_modifier_operation,
            resume_transaction=resume_bevel_modifier_transaction,
            verify_stage=verify_bevel_modifier_stage,
        )
    if action_name == SINGLE_MATERIAL_ACTION_NAME:
        return SimpleNamespace(
            action_name=SINGLE_MATERIAL_ACTION_NAME,
            recipe_id=SINGLE_MATERIAL_RECIPE_ID,
            validate_definition=validate_single_material,
            execute_operation=execute_single_material_operation,
            inverse_operation=inverse_single_material_operation,
            resume_transaction=resume_single_material_transaction,
            verify_stage=verify_single_material_stage,
        )
    if action_name == MATERIAL_PALETTE_ACTION_NAME:
        return SimpleNamespace(
            action_name=MATERIAL_PALETTE_ACTION_NAME,
            recipe_id=MATERIAL_PALETTE_RECIPE_ID,
            validate_definition=validate_material_palette,
            execute_operation=execute_material_palette_operation,
            inverse_operation=inverse_material_palette_operation,
            resume_transaction=resume_material_palette_transaction,
            verify_stage=verify_material_palette_stage,
        )
    if action_name == SUBDIVISION_SURFACE_ACTION_NAME:
        return SimpleNamespace(
            action_name=SUBDIVISION_SURFACE_ACTION_NAME,
            recipe_id=SUBDIVISION_SURFACE_RECIPE_ID,
            validate_definition=validate_subdivision_surface,
            execute_operation=execute_subdivision_surface_operation,
            inverse_operation=inverse_subdivision_surface_operation,
            resume_transaction=resume_subdivision_surface_transaction,
            verify_stage=verify_subdivision_surface_stage,
        )
    if action_name == EDIT_BEVEL_ACTION_NAME:
        return SimpleNamespace(
            action_name=EDIT_BEVEL_ACTION_NAME,
            recipe_id=EDIT_BEVEL_RECIPE_ID,
            validate_definition=validate_edit_bevel,
            execute_operation=execute_edit_bevel_operation,
            inverse_operation=inverse_edit_bevel_operation,
            resume_transaction=resume_edit_bevel_transaction,
            verify_stage=verify_edit_bevel_stage,
        )
    if action_name == EDIT_INSET_ACTION_NAME:
        return SimpleNamespace(
            action_name=EDIT_INSET_ACTION_NAME,
            recipe_id=EDIT_INSET_RECIPE_ID,
            validate_definition=validate_edit_inset,
            execute_operation=execute_edit_inset_operation,
            inverse_operation=inverse_edit_inset_operation,
            resume_transaction=resume_edit_inset_transaction,
            verify_stage=verify_edit_inset_stage,
        )
    if action_name == EDIT_TRIANGULATE_ACTION_NAME:
        return SimpleNamespace(
            action_name=EDIT_TRIANGULATE_ACTION_NAME,
            recipe_id=EDIT_TRIANGULATE_RECIPE_ID,
            validate_definition=validate_edit_triangulate,
            execute_operation=execute_edit_triangulate_operation,
            inverse_operation=inverse_edit_triangulate_operation,
            resume_transaction=resume_edit_triangulate_transaction,
            verify_stage=verify_edit_triangulate_stage,
        )
    if action_name == EDIT_EXTRUDE_REGION_ACTION_NAME:
        return SimpleNamespace(
            action_name=EDIT_EXTRUDE_REGION_ACTION_NAME,
            recipe_id=EDIT_EXTRUDE_REGION_RECIPE_ID,
            validate_definition=validate_edit_extrude_region,
            execute_operation=execute_edit_extrude_region_operation,
            inverse_operation=inverse_edit_extrude_region_operation,
            resume_transaction=resume_edit_extrude_region_transaction,
            verify_stage=verify_edit_extrude_region_stage,
        )
    if action_name == EDIT_POKE_ACTION_NAME:
        return SimpleNamespace(
            action_name=EDIT_POKE_ACTION_NAME,
            recipe_id=EDIT_POKE_RECIPE_ID,
            validate_definition=validate_edit_poke,
            execute_operation=execute_edit_poke_operation,
            inverse_operation=inverse_edit_poke_operation,
            resume_transaction=resume_edit_poke_transaction,
            verify_stage=verify_edit_poke_stage,
        )
    if action_name == MIRROR_ACTION_NAME:
        return SimpleNamespace(
            action_name=MIRROR_ACTION_NAME,
            recipe_id=MIRROR_RECIPE_ID,
            validate_definition=validate_mirror,
            execute_operation=execute_mirror_operation,
            inverse_operation=inverse_mirror_operation,
            resume_transaction=resume_mirror_transaction,
            verify_stage=verify_mirror_stage,
        )
    raise ValueError("The guided action has no operation executor")


def reset_native_menu_guidance():
    from .native_menu_guidance import reset_native_menu_guidance as reset_guidance

    return reset_guidance()


def _prepare_history(
    operator,
    context,
    session,
    operation: str,
    *,
    allow_execution_track_override: bool = False,
) -> bool:
    if _companion().shortcut_mutation_blocked and not allow_execution_track_override:
        message = (
            "Native Undo must restore the shortcut proof before changing the walkthrough or scene"
        )
        operator.report({"ERROR"}, message)
        return False
    try:
        prepare_native_history(session, context.scene, operation)
    except (OSError, RuntimeError, ValueError) as error:
        _companion().report("error", step=session.active_step, error=str(error))
        operator.report({"ERROR"}, str(error))
        return False
    return True


def _commit_history(
    operator,
    session,
    *,
    rollback=None,
    quarantine: bool = False,
    recovery_probe=None,
) -> bool:
    operator._operating_line_native_undo_required = False
    try:
        options = {}
        if rollback is not None:
            options["rollback"] = rollback
        if quarantine:
            options["quarantine"] = True
        if recovery_probe is not None:
            options["recovery_probe"] = recovery_probe
        commit_native_history(session, **options)
    except (OSError, RuntimeError, ValueError) as error:
        operator._operating_line_native_undo_required = (
            is_native_undo_required_error(error)
            or native_history_requires_native_undo()
        )
        _companion().report("error", step=session.active_step, error=str(error))
        operator.report(
            (
                {"WARNING"}
                if operator._operating_line_native_undo_required
                else {"ERROR"}
            ),
            str(error),
        )
        return False
    return True


def _history_commit_failure_result(operator):
    if getattr(operator, "_operating_line_native_undo_required", False):
        operator.report(
            {"WARNING"},
            "Blender native Undo is required before any further scene mutation",
        )
        return {"FINISHED"}
    return {"CANCELLED"}


def _probe_matches(probe) -> bool:
    if probe is None:
        return False
    try:
        return probe() is True
    except Exception:
        return False


def _finish_failed_operation(
    operator,
    session,
    candidate,
    error,
    *,
    recovery_probe=None,
):
    """Keep a coherent partial reset undoable; cancel atomic failures."""
    changed = prepared_native_history_changed(session)
    host_recovery_proven = is_action_host_state_restored_error(
        error
    ) or _probe_matches(recovery_probe)
    quarantine = (
        is_guided_geometry_atomicity_error(error)
        or is_action_atomicity_error(error)
        or not host_recovery_proven
    )
    if changed or quarantine:
        committed = _commit_history(
            operator,
            session,
            quarantine=quarantine,
            recovery_probe=recovery_probe,
        )
    else:
        cancel_native_history()
        committed = False
    _companion().report("error", step=candidate, error=str(error))
    undo_required = quarantine or getattr(
        operator, "_operating_line_native_undo_required", False
    )
    operator.report({"WARNING"} if undo_required else {"ERROR"}, str(error))
    if quarantine:
        operator.report(
            {"WARNING"},
            "Blender native Undo is required before any further scene mutation",
        )
        # FINISHED lets Blender's UNDO operator boundary capture any mutation whose
        # internal compensation could not be proven. The history journal blocks all
        # further mutation until that exact boundary is restored.
        return {"FINISHED"}
    if changed and committed:
        return {"FINISHED"}
    return _history_commit_failure_result(operator)


def _execute_next(operator, context, *, allow_execution_track_override=False):
    """Run the canonical next action for both control and native-menu entry."""

    clear_native_rna_badge()
    if _companion().proposed_plan is not None:
        message = "Accept or reject the pending plan proposal before continuing"
        operator.report({"WARNING"}, message)
        return {"CANCELLED"}
    session = _session()
    next_index = session.active_index + 1
    candidate = session.steps[next_index] if next_index < len(session.steps) else None
    if (
        candidate is not None
        and getattr(candidate, "execution_track_override", None) is not None
        and not allow_execution_track_override
    ):
        error = "execution_track_executor_unavailable"
        _companion().report("error", step=candidate, error=error)
        operator.report(
            {"ERROR"},
            "The selected menu or shortcut execution track has no available executor",
        )
        refresh_native_menu_guidance()
        return {"CANCELLED"}
    if (
        candidate is not None
        and getattr(candidate, "candidate_menu_projection", None) is not None
    ):
        error = "candidate_menu_execution_forbidden"
        _companion().report("error", step=candidate, error=error)
        operator.report(
            {"WARNING"},
            "This candidate-only menu path is instructional and cannot execute the managed action",
        )
        refresh_native_menu_guidance()
        return {"CANCELLED"}
    if not _prepare_history(
        operator,
        context,
        session,
        "next",
        allow_execution_track_override=allow_execution_track_override,
    ):
        return {"CANCELLED"}
    observation_attempt = 1
    while True:
        try:
            step = session.next(observation_attempt)
            break
        except ObservationGateError as error:
            if error.gate.status == "retry_scheduled":
                _companion().report(
                    "step_observation_failed",
                    step=error.step,
                    observations_override=error.gate.observation_copy(),
                    observation_gate_override=error.gate,
                )
                operator.report({"INFO"}, str(error))
                observation_attempt += 1
                continue
            rollback_failed = error.gate.status == "rollback_failed"
            if rollback_failed:
                if not _commit_history(operator, session, quarantine=True):
                    result = _history_commit_failure_result(operator)
                else:
                    result = {"FINISHED"}
            elif error.gate.blocking and prepared_native_history_changed(session):
                if not _commit_history(operator, session):
                    return {"FINISHED"}
                result = {"FINISHED"}
            else:
                cancel_native_history()
                result = {"CANCELLED"}
            _companion().report(
                "step_observation_failed",
                step=error.step,
                observations_override=error.gate.observation_copy(),
                observation_gate_override=error.gate,
            )
            operator.report({"WARNING"}, str(error))
            if rollback_failed:
                operator.report(
                    {"WARNING"},
                    "Blender native Undo is required before any further scene mutation",
                )
            refresh_native_menu_guidance()
            return result
        except (OSError, RuntimeError, ValueError) as error:
            refresh_native_menu_guidance()
            return _finish_failed_operation(operator, session, candidate, error)
    if step is None:
        cancel_native_history()
        operator.report({"INFO"}, "All demo steps are complete")
        refresh_native_menu_guidance()
        return {"CANCELLED"}
    if not _commit_history(operator, session):
        return {"FINISHED"}
    _companion().report("step_succeeded", step=step)
    refresh_native_menu_guidance()
    return {"FINISHED"}


def _draw_provider_authorization(
    layout,
    provider,
    *,
    initial: bool = False,
    dialogue: bool = False,
) -> None:
    """Draw the shared per-call data and possible-charge disclosure."""
    layout.label(
        text=f"Authorize one run with {provider['displayName']}?",
        icon="QUESTION",
    )
    location = provider["dataHandling"]["executionLocation"]
    if location == "remote":
        layout.label(text="Data is sent to the selected remote provider", icon="URL")
        if initial:
            layout.label(
                text=(
                    "Sends your goal, ActionCatalog, and current state of "
                    "this exact Blender instance"
                )
            )
        elif dialogue:
            layout.label(text="Sends this message, recent dialogue, and candidate revision")
            layout.label(text="Also sends the base Plan, references, and latest state")
        else:
            layout.label(text="Sends your message, base Plan, and node references")
            layout.label(text="Also sends ActionCatalog and latest companion state")
        layout.label(text="The provider may charge for this call")
        layout.label(text="OperatingLine cannot estimate provider charges")
    else:
        layout.label(text="Local provider: no provider data transmission", icon="HOME")
        layout.label(text="The provider description may define local execution costs")
        layout.label(text="OperatingLine cannot estimate provider charges")
    layout.separator()
    if dialogue:
        layout.label(text="This authorization permits at most two provider calls")
        layout.label(text="Call 1 streams the reply and classifies semantic intent")
        layout.label(text="At confidence 80%+, call 2 prepares a Plan revision")
    layout.label(text="The runtime may create one review proposal")
    layout.label(text="It will not Accept, execute, or change the scene")
    layout.label(text="Retrying opens a new confirmation and uses a new run ID")


class OPERATINGLINE_OT_start(bpy.types.Operator):
    bl_idname = "operating_line.start"
    bl_label = "Start"
    bl_description = "Reset and start the active walkthrough"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        if _companion().proposed_plan is not None:
            message = "Accept or reject the pending plan proposal before starting"
            self.report({"WARNING"}, message)
            return {"CANCELLED"}
        session = _session()
        if getattr(session, "has_pending_leaf_operations", False):
            self.report(
                {"WARNING"},
                "Finish or abort the leaf operation run before restarting",
            )
            return {"CANCELLED"}
        if not _prepare_history(self, context, session, "start"):
            return {"CANCELLED"}
        try:
            session.start()
        except (OSError, RuntimeError, ValueError) as error:
            return _finish_failed_operation(
                self,
                session,
                session.active_step,
                error,
            )
        if context.scene.operating_line_replace_factory_scene:
            removed = remove_factory_startup_objects(context.scene)
            if not removed:
                self.report(
                    {"WARNING"},
                    "Factory scene fingerprint did not match; no existing object was deleted",
                )
        if not _commit_history(self, session):
            return {"FINISHED"}
        context.window_manager.operating_line_overlay_enabled = True
        enable_native_menu_guidance(_session)
        enable_overlay(_session, interaction_guidance_snapshot)
        _companion().report("walkthrough_started")
        return {"FINISHED"}


class OPERATINGLINE_OT_next(bpy.types.Operator):
    bl_idname = "operating_line.next"
    bl_label = "Next"
    bl_description = "Execute the next accepted plan step"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        return _execute_next(self, context)


class OPERATINGLINE_OT_execution_track_managed_commit(bpy.types.Operator):
    bl_idname = "operating_line.execution_track_managed_commit"
    bl_label = "Execution Track Managed Commit"
    bl_description = "Internal one-shot commit after reviewed menu proof and server ACK"
    bl_options = {"INTERNAL", "UNDO"}

    authorization_token: bpy.props.StringProperty(
        options={"HIDDEN", "SKIP_SAVE"}
    )

    def execute(self, context):
        companion = _companion()
        if not companion.authorize_execution_track_managed_commit(
            self.authorization_token
        ):
            self.report({"ERROR"}, "Execution-track managed commit authority is unavailable")
            return {"CANCELLED"}
        result = _execute_next(
            self,
            context,
            allow_execution_track_override=True,
        )
        companion.complete_execution_track_managed_commit()
        return {"FINISHED"} if "FINISHED" not in result else result


def _move_leaf_operation_focus(operator, move) -> set[str]:
    """Apply one stale-safe instructional move without touching the scene."""

    session = _session()
    step = session.guidance_step
    if step is None or step.id != operator.step_id:
        operator.report({"WARNING"}, "The current leaf changed; instruction ignored")
        return {"CANCELLED"}
    if not move(
        step,
        operator.operation_id,
        operator.ordinal,
        operator.cursor_token,
    ):
        operator.report({"WARNING"}, "The leaf operation focus changed; instruction ignored")
        return {"CANCELLED"}
    clear_native_rna_badge()
    return {"FINISHED"}


class OPERATINGLINE_OT_leaf_operation_back(bpy.types.Operator):
    bl_idname = "operating_line.leaf_operation_back"
    bl_label = "Previous Leaf Instruction"
    bl_description = "View the previous instruction without undoing or changing Blender"

    step_id: bpy.props.StringProperty()
    operation_id: bpy.props.StringProperty()
    ordinal: bpy.props.IntProperty(min=1)
    cursor_token: bpy.props.StringProperty()

    def execute(self, _context):
        return _move_leaf_operation_focus(self, focus_previous_leaf_operation)


class OPERATINGLINE_OT_leaf_operation_next(bpy.types.Operator):
    bl_idname = "operating_line.leaf_operation_next"
    bl_label = "Next Leaf Instruction"
    bl_description = "View the next instruction without executing or changing Blender"

    step_id: bpy.props.StringProperty()
    operation_id: bpy.props.StringProperty()
    ordinal: bpy.props.IntProperty(min=1)
    cursor_token: bpy.props.StringProperty()

    def execute(self, _context):
        return _move_leaf_operation_focus(self, focus_next_leaf_operation)


class OPERATINGLINE_OT_leaf_operation_retry(bpy.types.Operator):
    bl_idname = "operating_line.leaf_operation_retry"
    bl_label = "Retry Leaf Instruction"
    bl_description = "Re-highlight this instruction without repeating its Blender action"

    step_id: bpy.props.StringProperty()
    operation_id: bpy.props.StringProperty()
    ordinal: bpy.props.IntProperty(min=1)
    cursor_token: bpy.props.StringProperty()

    def execute(self, _context):
        result = _move_leaf_operation_focus(self, retry_leaf_operation)
        if result == {"FINISHED"}:
            session = _session()
            step = session.guidance_step
            snapshot = leaf_guidance_snapshot(step) if step is not None else None
            if snapshot is not None and snapshot.focused_operation.reference:
                self.report(
                    {"INFO"},
                    "Reference-only instruction re-highlighted; no UI action was executed",
                )
        return result


def _matching_guided_geometry_control(operator):
    """Resolve one stale-safe control from the current accepted leaf."""

    session = _session()
    step = session.guidance_step
    snapshot = leaf_guidance_snapshot(step) if step is not None else None
    model = guided_control_dock_model(
        step,
        snapshot,
        getattr(session, "pending_leaf_operation_run", None),
    )
    action_name = getattr(getattr(step, "action", None), "name", None)
    profile = _guided_geometry_execution_profile(action_name)
    if (
        model is None
        or model.step_id != operator.step_id
        or model.cursor_token != operator.cursor_token
        or snapshot.recipe_id != profile.recipe_id
        or not model.operation_execution_available
    ):
        raise ValueError("The guided leaf changed; control ignored")
    if not operator.operation_id:
        if operator.ordinal != 0:
            raise ValueError("The guided leaf control changed; ignored")
        return step, snapshot, None
    operation = next(
        (
            candidate
            for candidate in snapshot.operations
            if candidate.operation_id == operator.operation_id
            and candidate.ordinal == operator.ordinal
        ),
        None,
    )
    if operation is None:
        raise ValueError("The guided operation changed; control ignored")
    return step, snapshot, operation


def _matching_guided_parameter_control(operator):
    """Resolve one reviewed parameter control without enabling its executor."""

    session = _session()
    step = session.guidance_step
    snapshot = leaf_guidance_snapshot(step) if step is not None else None
    model = guided_control_dock_model(
        step,
        snapshot,
        getattr(session, "pending_leaf_operation_run", None),
    )
    if (
        model is None
        or model.step_id != operator.step_id
        or model.cursor_token != operator.cursor_token
    ):
        raise ValueError("The guided leaf changed; control ignored")
    operation = next(
        (
            candidate
            for candidate in snapshot.operations
            if candidate.operation_id == operator.operation_id
            and candidate.ordinal == operator.ordinal
        ),
        None,
    )
    editable_operation_ids = {
        control.operation_id for control in (*model.vectors, *model.scalars)
    }
    if operation is None or operation.operation_id not in editable_operation_ids:
        raise ValueError("The guided leaf parameter changed; control ignored")
    return step, snapshot, operation


def _guided_geometry_transaction(session, step, run, definition, profile):
    """Resume process-local executor state from the Undo-restorable session run."""

    completed = tuple(receipt.ordinal for receipt in run.operation_receipts)
    if not completed:
        return None
    if run.partial_action_receipt is None:
        transaction = None
        for expected in run.operation_receipts:
            replay = profile.execute_operation(
                operation_ordinal=expected.ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=transaction,
            )
            if (
                replay.before_fingerprint != expected.before_sha256
                or replay.after_fingerprint != expected.after_sha256
                or _guided_receipt_has_state(replay.receipt)
            ):
                raise RuntimeError("Guided leaf pre-mutation fingerprint changed")
            transaction = replay.transaction
        return transaction
    return profile.resume_transaction(
        receipt=run.partial_action_receipt,
        completed_operations=completed,
        fingerprint=run.operation_receipts[-1].after_sha256,
        definition=definition,
    )


def _guided_geometry_recovery_probe(
    session,
    step,
    run,
    definition,
    profile,
    *,
    empty_stage_fingerprint=None,
    empty_stage_receipt_id=None,
):
    """Capture a native-Undo-safe proof of the exact prepared host stage."""

    receipts = dict(session.receipts)
    if run is not None and run.operation_receipts:
        completed = tuple(receipt.ordinal for receipt in run.operation_receipts)
        expected_fingerprint = run.operation_receipts[-1].after_sha256
        partial_receipt = run.partial_action_receipt
        receipt_id = run.leaf_receipt_id
    elif empty_stage_fingerprint is not None and empty_stage_receipt_id:
        completed = ()
        expected_fingerprint = empty_stage_fingerprint
        partial_receipt = None
        receipt_id = empty_stage_receipt_id
    else:
        return None

    def prove_prepared_stage():
        return profile.verify_stage(
            receipt_id=receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=receipts,
            definition=definition,
            completed_operations=completed,
            expected_fingerprint=expected_fingerprint,
            partial_receipt=partial_receipt,
            rebind_after_native_restore=True,
        )

    return prove_prepared_stage


def _bind_guided_geometry_observation(result, run):
    """Bind executor evidence to the accepted run before Session records it."""

    observation = deepcopy(result.observation)
    if not isinstance(observation, dict) or not isinstance(
        observation.get("details"), dict
    ):
        raise RuntimeError("Guided leaf executor returned invalid observation evidence")
    observation["details"].update(
        {
            "runId": run.run_id,
            "recipeId": run.recipe_id,
            "catalogVersion": run.catalog_version,
        }
    )
    return observation


def _guided_receipt_has_state(receipt) -> bool:
    if receipt is None:
        return False
    if not any(hasattr(receipt, field) for field in ("created", "mutations", "deleted")):
        return True
    return bool(
        getattr(receipt, "created", ())
        or getattr(receipt, "mutations", ())
        or getattr(receipt, "deleted", ())
    )


def _replay_guided_geometry_prefix(
    session,
    step,
    run,
    definition,
    profile,
    *,
    recovery_probe,
):
    """Idempotently rebuild the prepared operation prefix after host rollback."""

    if recovery_probe is not None and _probe_matches(recovery_probe):
        return run, recovery_probe
    transaction = None
    replayed_partial = None
    replayed_receipts = []
    for receipt in run.operation_receipts:
        result = profile.execute_operation(
            operation_ordinal=receipt.ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = result.transaction
        replayed_partial = result.receipt
        replayed_receipts.append(
            replace(
                receipt,
                before_sha256=result.before_fingerprint,
                after_sha256=result.after_fingerprint,
                observation=_bind_guided_geometry_observation(result, run),
            )
        )
    replayed_run = replace(
        run,
        operation_receipts=tuple(replayed_receipts),
        partial_action_receipt=(
            replayed_partial
            if replayed_partial is not None
            and _guided_receipt_has_state(replayed_partial)
            else None
        ),
    )
    replayed_probe = _guided_geometry_recovery_probe(
        session,
        step,
        replayed_run,
        definition,
        profile,
    )
    if replayed_probe is None or not _probe_matches(replayed_probe):
        raise RuntimeError(
            "Guided leaf prefix replay did not restore the prepared Blender state"
        )
    return replayed_run, replayed_probe


def _focus_after_guided_geometry_forward(step, snapshot) -> None:
    if snapshot.can_focus_next:
        focus_next_leaf_operation(
            step,
            snapshot.focused_operation.operation_id,
            snapshot.focused_ordinal,
            snapshot.cursor_token,
        )


def _focus_after_guided_geometry_back(step, snapshot, undone_ordinal: int) -> None:
    if snapshot.focused_ordinal == undone_ordinal + 1 and snapshot.can_focus_back:
        focus_previous_leaf_operation(
            step,
            snapshot.focused_operation.operation_id,
            snapshot.focused_ordinal,
            snapshot.cursor_token,
        )


class OPERATINGLINE_OT_edit_guided_geometry_parameter(bpy.types.Operator):
    bl_idname = "operating_line.edit_guided_geometry_parameter"
    bl_label = "Edit Guided Geometry Parameter"
    bl_description = (
        "Edit this accepted value as a revision draft; the active Plan and scene stay unchanged"
    )

    step_id: bpy.props.StringProperty(options={"HIDDEN"})
    operation_id: bpy.props.StringProperty(options={"HIDDEN"})
    ordinal: bpy.props.IntProperty(min=1, options={"HIDDEN"})
    cursor_token: bpy.props.StringProperty(options={"HIDDEN"})
    argument_name: bpy.props.StringProperty(options={"HIDDEN"})
    value_kind: bpy.props.StringProperty(options={"HIDDEN"})
    integer_value: bpy.props.IntProperty(name="Requested value")
    scalar_value: bpy.props.FloatProperty(name="Requested value", precision=6)
    vector_value: bpy.props.FloatVectorProperty(
        name="Requested value",
        size=3,
        precision=6,
    )

    def invoke(self, context, _event):
        try:
            _step, _snapshot, operation = _matching_guided_parameter_control(self)
            if operation is None:
                raise ValueError("The guided parameter operation is unavailable")
            parameters = tuple(operation.parameters)
            if len(parameters) != 1 or not parameters[0].resolved:
                raise ValueError("The guided parameter is unresolved")
            parameter = parameters[0]
            value = parameter.value
            if parameter.name in {"translation", "rotation", "scale"}:
                value = tuple(value)
                if len(value) != 3:
                    raise ValueError("The guided vector must contain three values")
                self.value_kind = "vector3"
            elif isinstance(value, int) and not isinstance(value, bool):
                self.value_kind = "integer"
            elif isinstance(value, float) and math.isfinite(value):
                self.value_kind = "number"
            else:
                raise ValueError("The guided parameter is not an editable finite number")
        except (TypeError, ValueError) as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.argument_name = parameter.name
        if self.value_kind == "vector3":
            self.vector_value = tuple(float(component) for component in value)
        elif self.value_kind == "integer":
            self.integer_value = value
        else:
            self.scalar_value = value
        self._dialog_opened = True
        return context.window_manager.invoke_props_dialog(self, width=420)

    def draw(self, _context):
        self.layout.label(
            text=f"GUIDED CONTROL · {self.argument_name.title()}",
            icon="TOOL_SETTINGS",
        )
        if self.value_kind == "vector3":
            for index, axis in enumerate("XYZ"):
                self.layout.prop(self, "vector_value", index=index, text=axis)
        elif self.value_kind == "integer":
            self.layout.prop(self, "integer_value")
        else:
            self.layout.prop(self, "scalar_value")
        self.layout.label(
            text="Creates a revision draft; it does not bypass the accepted Plan",
            icon="INFO",
        )

    def execute(self, _context):
        if not getattr(self, "_dialog_opened", False):
            self.report({"ERROR"}, "Open the guided parameter editor first")
            return {"CANCELLED"}
        try:
            step, _snapshot, operation = _matching_guided_parameter_control(self)
            if operation is None:
                raise ValueError("The guided parameter operation is unavailable")
            parameter = tuple(operation.parameters)[0]
            if parameter.name != self.argument_name:
                raise ValueError("The guided parameter changed; edit ignored")
            if self.value_kind == "vector3":
                value = [float(component) for component in self.vector_value]
            elif self.value_kind == "integer":
                value = int(self.integer_value)
            elif self.value_kind == "number":
                value = float(self.scalar_value)
                if not math.isfinite(value):
                    raise ValueError("The guided parameter must remain finite")
            else:
                raise ValueError("The guided parameter type changed; edit ignored")
            companion = _companion()
            if not companion.has_revision_reference("active", step.id):
                companion.add_revision_reference("active", step.id)
            companion.set_revision_parameter_edit(step.id, self.argument_name, value)
            companion.revision_request_status = (
                f"Guided {self.argument_name} edit staged; review before applying"
            )
        except (IndexError, TypeError, ValueError) as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self._dialog_opened = False
        self.report(
            {"INFO"},
            "Guided value staged in the revision draft; scene unchanged",
        )
        return {"FINISHED"}


class OPERATINGLINE_OT_highlight_guided_geometry_parameter(bpy.types.Operator):
    bl_idname = "operating_line.highlight_guided_geometry_parameter"
    bl_label = "Highlight Native Geometry Parameter"
    bl_description = (
        "Use Blender 5.3+ to highlight one visible native RNA value component"
    )
    bl_options = {"INTERNAL"}

    step_id: bpy.props.StringProperty(options={"HIDDEN"})
    operation_id: bpy.props.StringProperty(options={"HIDDEN"})
    ordinal: bpy.props.IntProperty(min=1, options={"HIDDEN"})
    cursor_token: bpy.props.StringProperty(options={"HIDDEN"})
    argument_name: bpy.props.StringProperty(options={"HIDDEN"})
    component_index: bpy.props.IntProperty(min=0, max=2, options={"HIDDEN"})
    write_order: bpy.props.IntProperty(min=1, max=2, default=1, options={"HIDDEN"})

    def execute(self, context):
        clear_native_rna_badge()
        try:
            step, snapshot, operation = _matching_guided_parameter_control(self)
            if operation is None:
                raise ValueError("The guided parameter operation is unavailable")
            if snapshot.focused_ordinal != self.ordinal:
                raise ValueError("Focus this numbered instruction before native targeting")
            parameters = tuple(operation.parameters)
            if (
                len(parameters) != 1
                or not parameters[0].resolved
                or parameters[0].name != self.argument_name
            ):
                raise ValueError("The guided parameter binding changed; target ignored")
            target = resolve_guided_geometry_native_target(
                _session(),
                step,
                context,
                self.argument_name,
                write_order=self.write_order,
                resolve_resource=resolve_resource,
            )
            if not target.ready:
                raise ValueError(target.detail or "Native RNA target is unavailable")
            if self.component_index not in target.component_indexes:
                raise ValueError("The guided native component binding changed; target ignored")
            component_position = target.component_indexes.index(self.component_index)
            if component_position >= len(target.component_labels):
                raise ValueError("The guided native component label changed; target ignored")
            component = target.component_labels[component_position]
            result = try_activate_native_rna_button(
                context.window_manager,
                region=target.region,
                data=target.data,
                property=target.property_name,
                index=self.component_index,
            )
            if not result.is_exact:
                raise ValueError(
                    result.detail
                    or "The native value component is not visible in this Blender layout"
                )
            if not remember_native_rna_badge(
                result,
                region=target.region,
                step_id=step.id,
                operation_id=operation.operation_id,
                ordinal=operation.ordinal,
                cursor_token=snapshot.cursor_token,
                component_index=self.component_index,
                target_node=target.node,
                target_data=target.data,
            ):
                raise ValueError("The exact native marker could not be cursor-bound")
        except (AttributeError, IndexError, TypeError, ValueError) as error:
            clear_native_rna_badge()
            self.report({"WARNING"}, str(error))
            return {"CANCELLED"}
        area = getattr(context, "area", None)
        if callable(getattr(area, "tag_redraw", None)):
            area.tag_redraw()
        self.report(
            {"INFO"},
            f"EXACT NATIVE · {self.ordinal:02d}.{self.write_order:02d} "
            f"{self.argument_name}.{component}",
        )
        return {"FINISHED"}


class OPERATINGLINE_OT_execute_guided_geometry_operation(bpy.types.Operator):
    bl_idname = "operating_line.execute_guided_geometry_operation"
    bl_label = "Execute Guided Leaf Operation"
    bl_description = "Execute exactly this numbered guided operation and verify its state"
    bl_options = {"INTERNAL", "UNDO"}

    step_id: bpy.props.StringProperty(options={"HIDDEN"})
    operation_id: bpy.props.StringProperty(options={"HIDDEN"})
    ordinal: bpy.props.IntProperty(min=1, max=54, options={"HIDDEN"})
    cursor_token: bpy.props.StringProperty(options={"HIDDEN"})
    run_id: bpy.props.StringProperty(options={"HIDDEN"})

    def execute(self, context):
        clear_native_rna_badge()
        session = _session()
        if _companion().shortcut_mutation_blocked:
            self.report(
                {"ERROR"},
                "Native Undo must restore the shortcut proof before changing the walkthrough or scene",
            )
            return {"CANCELLED"}
        try:
            step, snapshot, operation = _matching_guided_geometry_control(self)
            profile = _guided_geometry_execution_profile(step.action.name)
            services = GuidedGeometryCommandServices(
                validate_definition=profile.validate_definition,
                execute_operation=profile.execute_operation,
                inverse_operation=profile.inverse_operation,
                resume_transaction=profile.resume_transaction,
                verify_stage=profile.verify_stage,
                history=GuidedGeometryHistoryPort(
                    # Native history needs Blender's Scene token.  The command only
                    # sees this injected, single-purpose callback, never UI context.
                    prepare=lambda history_operation: prepare_native_history(
                        session, context.scene, history_operation
                    ),
                    commit=commit_native_history,
                    cancel=cancel_native_history,
                    changed=prepared_native_history_changed,
                    make_recovery=_native_history_recovery,
                    requires_native_undo=native_history_requires_native_undo,
                    is_native_undo_required_error=is_native_undo_required_error,
                ),
                is_guided_atomicity_error=is_guided_geometry_atomicity_error,
                is_action_atomicity_error=is_action_atomicity_error,
                is_host_state_restored_error=is_action_host_state_restored_error,
                observation_gate_error=ObservationGateError,
            )
            command_result = execute_guided_geometry_operation(
                session=session,
                step=step,
                snapshot=snapshot,
                step_id=self.step_id,
                operation_id=self.operation_id,
                ordinal=self.ordinal,
                cursor_token=self.cursor_token,
                run_id=self.run_id,
                action_name=profile.action_name,
                recipe_id=profile.recipe_id,
                services=services,
            )
        except GuidedGeometryCommandRejected as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        except (AttributeError, OSError, RuntimeError, TypeError, ValueError) as error:
            _companion().report("error", step=session.active_step, error=str(error))
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}

        transition = command_result.report_transition
        if transition is not None:
            transition_options = {}
            if transition.error is not None:
                transition_options["error"] = transition.error
            if transition.observations_override is not None:
                transition_options["observations_override"] = (
                    transition.observations_override
                )
            if transition.observation_gate_override is not None:
                transition_options["observation_gate_override"] = (
                    transition.observation_gate_override
                )
            _companion().report(
                transition.name,
                step=transition.step,
                **transition_options,
            )
        if command_result.report_message is not None:
            self.report(
                {command_result.report_level}, command_result.report_message
            )
        self._operating_line_native_undo_required = (
            command_result.native_undo_required
        )
        if command_result.native_undo_required:
            self.report(
                {"WARNING"},
                "Blender native Undo is required before any further scene mutation",
            )
        if isinstance(command_result, GuidedGeometryCommandFailure):
            refresh_native_menu_guidance()
            return {command_result.operator_status}
        if command_result.operator_status != "FINISHED":
            refresh_native_menu_guidance()
            return {command_result.operator_status}
        if command_result.focus_next:
            _focus_after_guided_geometry_forward(step, snapshot)
        refresh_native_menu_guidance()
        return {command_result.operator_status}


class OPERATINGLINE_OT_undo_guided_geometry_operation(bpy.types.Operator):
    bl_idname = "operating_line.undo_guided_geometry_operation"
    bl_label = "Undo Guided Leaf Operation"
    bl_description = "Compensate only the latest verified guided leaf operation"
    bl_options = {"INTERNAL", "UNDO"}

    step_id: bpy.props.StringProperty(options={"HIDDEN"})
    operation_id: bpy.props.StringProperty(options={"HIDDEN"})
    ordinal: bpy.props.IntProperty(min=1, max=54, options={"HIDDEN"})
    cursor_token: bpy.props.StringProperty(options={"HIDDEN"})
    run_id: bpy.props.StringProperty(options={"HIDDEN"})

    def execute(self, context):
        clear_native_rna_badge()
        session = _session()
        try:
            step, snapshot, operation = _matching_guided_geometry_control(self)
            run = session.pending_leaf_operation_run
            if run is None or run.run_id != self.run_id:
                raise ValueError("The guided operation run changed; Back ignored")
            if not run.operation_receipts:
                raise ValueError("No guided operation is available to undo")
            latest = run.operation_receipts[-1]
            if (
                latest.operation_id != operation.operation_id
                or latest.ordinal != operation.ordinal
            ):
                raise ValueError("Operation Back must target the latest receipt")
            profile = _guided_geometry_execution_profile(step.action.name)
            definition = profile.validate_definition(step.action.arguments)
        except (AttributeError, TypeError, ValueError) as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if not _prepare_history(self, context, session, "leaf_operation_back"):
            return {"CANCELLED"}
        prepared_session_snapshot = session.snapshot_state()
        commit_rollback = None
        recovery_probe = _guided_geometry_recovery_probe(
            session,
            step,
            run,
            definition,
            profile,
        )
        try:
            if self.ordinal == 1:
                partial_receipt = None
            else:
                transaction = _guided_geometry_transaction(
                    session,
                    step,
                    run,
                    definition,
                    profile,
                )
                inverse = profile.inverse_operation(
                    operation_ordinal=self.ordinal,
                    receipt_id=run.leaf_receipt_id,
                    step_id=step.id,
                    action_name=step.action.name,
                    receipts=session.receipts,
                    definition=definition,
                    transaction=transaction,
                )
                partial_receipt = (
                    inverse.receipt
                    if _guided_receipt_has_state(inverse.receipt)
                    else None
                )
            rollback_applied = False

            def rollback_operation_back():
                nonlocal rollback_applied
                if rollback_applied or self.ordinal == 1:
                    rollback_applied = True
                    return
                replayed = profile.execute_operation(
                    operation_ordinal=self.ordinal,
                    receipt_id=run.leaf_receipt_id,
                    step_id=step.id,
                    action_name=step.action.name,
                    receipts=session.receipts,
                    definition=definition,
                    transaction=inverse.transaction,
                )
                rollback_applied = True
                replayed_receipts = (
                    *run.operation_receipts[:-1],
                    replace(
                        run.operation_receipts[-1],
                        before_sha256=replayed.before_fingerprint,
                        after_sha256=replayed.after_fingerprint,
                        observation=_bind_guided_geometry_observation(replayed, run),
                    ),
                )
                replayed_run = replace(
                    run,
                    operation_receipts=replayed_receipts,
                    partial_action_receipt=(
                        replayed.receipt
                        if _guided_receipt_has_state(replayed.receipt)
                        else None
                    ),
                )
                replayed_probe = _guided_geometry_recovery_probe(
                    session,
                    step,
                    replayed_run,
                    definition,
                    profile,
                )
                if replayed_probe is None or not _probe_matches(replayed_probe):
                    raise RuntimeError(
                        "Operation Back replay did not restore the prepared Blender state"
                    )
                rebased_snapshot = session.rebase_leaf_operation_replay(
                    prepared_session_snapshot,
                    step_id=step.id,
                    original_run=run,
                    replayed_run=replayed_run,
                )
                return _native_history_recovery(
                    rebased_snapshot,
                    replayed_probe,
                )

            commit_rollback = rollback_operation_back
            session.rewind_leaf_operation(
                step,
                run_id=run.run_id,
                operation_id=operation.operation_id,
                ordinal=operation.ordinal,
                partial_action_receipt=partial_receipt,
            )
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            return _finish_failed_operation(
                self,
                session,
                step,
                error,
                recovery_probe=recovery_probe,
            )
        if not _commit_history(
            self,
            session,
            rollback=commit_rollback,
            recovery_probe=recovery_probe,
        ):
            refresh_native_menu_guidance()
            return _history_commit_failure_result(self)
        _focus_after_guided_geometry_back(step, snapshot, self.ordinal)
        self.report({"INFO"}, f"Operation {self.ordinal:02d} compensated")
        refresh_native_menu_guidance()
        return {"FINISHED"}


class OPERATINGLINE_OT_abort_guided_geometry_operations(bpy.types.Operator):
    bl_idname = "operating_line.abort_guided_geometry_operations"
    bl_label = "Abort Guided Leaf Operations"
    bl_description = "Rollback the partial guided leaf and return to operation 01"
    bl_options = {"INTERNAL", "UNDO"}

    step_id: bpy.props.StringProperty(options={"HIDDEN"})
    cursor_token: bpy.props.StringProperty(options={"HIDDEN"})
    run_id: bpy.props.StringProperty(options={"HIDDEN"})

    def execute(self, context):
        clear_native_rna_badge()
        session = _session()
        step = session.guidance_step
        snapshot = leaf_guidance_snapshot(step) if step is not None else None
        run = session.pending_leaf_operation_run
        if (
            step is None
            or snapshot is None
            or step.id != self.step_id
            or snapshot.cursor_token != self.cursor_token
            or run is None
            or run.run_id != self.run_id
        ):
            self.report({"ERROR"}, "The guided operation run changed; Abort ignored")
            return {"CANCELLED"}
        try:
            profile = _guided_geometry_execution_profile(step.action.name)
            definition = profile.validate_definition(step.action.arguments)
        except (TypeError, ValueError) as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if not _prepare_history(self, context, session, "leaf_operation_back"):
            return {"CANCELLED"}
        prepared_session_snapshot = session.snapshot_state()
        commit_rollback = None
        recovery_probe = _guided_geometry_recovery_probe(
            session,
            step,
            run,
            definition,
            profile,
        )
        try:
            session.abort_leaf_operation_run()

            def rollback_abort():
                replayed_run, replayed_probe = _replay_guided_geometry_prefix(
                    session,
                    step,
                    run,
                    definition,
                    profile,
                    recovery_probe=recovery_probe,
                )
                rebased_snapshot = session.rebase_leaf_operation_replay(
                    prepared_session_snapshot,
                    step_id=step.id,
                    original_run=run,
                    replayed_run=replayed_run,
                )
                return _native_history_recovery(
                    rebased_snapshot,
                    replayed_probe,
                )

            commit_rollback = rollback_abort
        except (OSError, RuntimeError, ValueError) as error:
            return _finish_failed_operation(
                self,
                session,
                step,
                error,
                recovery_probe=recovery_probe,
            )
        if not _commit_history(
            self,
            session,
            rollback=commit_rollback,
            recovery_probe=recovery_probe,
        ):
            refresh_native_menu_guidance()
            return _history_commit_failure_result(self)
        reset_native_menu_guidance()
        self.report({"INFO"}, "Partial guided leaf rolled back")
        refresh_native_menu_guidance()
        return {"FINISHED"}


class OPERATINGLINE_OT_execute_guided_geometry_leaf(bpy.types.Operator):
    bl_idname = "operating_line.execute_guided_geometry_leaf"
    bl_label = "Execute Guided Leaf Atomically"
    bl_description = (
        "Run the accepted action atomically; this proxy does not claim native control clicks"
    )
    bl_options = {"INTERNAL", "UNDO"}

    step_id: bpy.props.StringProperty(options={"HIDDEN"})
    operation_id: bpy.props.StringProperty(options={"HIDDEN"})
    ordinal: bpy.props.IntProperty(min=0, options={"HIDDEN"})
    cursor_token: bpy.props.StringProperty(options={"HIDDEN"})

    def execute(self, context):
        try:
            _step, _snapshot, operation = _matching_guided_geometry_control(self)
            if self.operation_id and getattr(operation, "connection", None) is None:
                raise ValueError("The guided connection proxy binding changed; ignored")
        except ValueError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if self.operation_id:
            self.report(
                {"INFO"},
                "Connection proxy runs the complete accepted leaf atomically",
            )
        return _execute_next(self, context)


class OPERATINGLINE_OT_verify_execution_track(bpy.types.Operator):
    bl_idname = "operating_line.verify_execution_track"
    bl_label = "Verify Track"
    bl_description = (
        "Verify the exact accepted menu or shortcut track without executing or changing Blender"
    )

    def execute(self, _context):
        companion = _companion()
        try:
            request = companion.request_execution_track_preflight()
        except (KeyError, RuntimeError, TypeError, ValueError) as error:
            companion.execution_track_preflight_message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Track verification {request['requestId'][:8]} queued")
        return {"FINISHED"}


class OPERATINGLINE_OT_recheck_observations(bpy.types.Operator):
    bl_idname = "operating_line.recheck_observations"
    bl_label = "Recheck Observations"
    bl_description = "Re-evaluate the blocked step without executing it again"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        session = _session()
        candidate = session.active_step
        if not _prepare_history(self, context, session, "recheck"):
            return {"CANCELLED"}
        try:
            step = session.recheck_observations()
        except ObservationGateError as error:
            _companion().report(
                "step_observation_failed",
                step=error.step,
                observations_override=error.gate.observation_copy(),
                observation_gate_override=error.gate,
            )
            self.report({"WARNING"}, str(error))
            refresh_native_menu_guidance()
            cancel_native_history()
            return {"CANCELLED"}
        except ValueError as error:
            cancel_native_history()
            self.report({"WARNING"}, str(error))
            refresh_native_menu_guidance()
            return {"CANCELLED"}
        except (OSError, RuntimeError) as error:
            refresh_native_menu_guidance()
            return _finish_failed_operation(self, session, candidate, error)
        gate = session.observation_gate
        if gate is None:
            error = RuntimeError(
                "Recovered observation gate was not retained for reporting"
            )
            return _finish_failed_operation(self, session, candidate, error)
        if not _commit_history(self, session):
            return {"FINISHED"}
        _companion().report(
            "observation_recovered",
            step=step,
            observations_override=gate.observation_copy(),
            observation_gate_override=gate,
        )
        self.report({"INFO"}, gate.message)
        refresh_native_menu_guidance()
        return {"FINISHED"}


class OPERATINGLINE_OT_open_add_menu(bpy.types.Operator):
    bl_idname = "operating_line.open_add_menu"
    bl_label = "Open Guided Add Menu"
    bl_description = "Open Blender's native Add menu without changing the scene"
    bl_options = {"INTERNAL"}

    def execute(self, _context):
        result = bpy.ops.wm.call_menu("EXEC_DEFAULT", name="VIEW3D_MT_add")
        if result not in ({"INTERFACE"}, {"RUNNING_MODAL"}):
            self.report({"ERROR"}, "Blender could not open the native Add menu")
            return {"CANCELLED"}
        return {"FINISHED"}

    def invoke(self, context, _event):
        return self.execute(context)


class OPERATINGLINE_OT_guided_menu_action(bpy.types.Operator):
    bl_idname = "operating_line.guided_menu_action"
    bl_label = "Execute Guided Plan Step"
    bl_description = (
        "Execute this exact accepted leaf using its planned parameters and shared Back receipt"
    )
    bl_options = {"INTERNAL", "UNDO"}

    step_id: bpy.props.StringProperty()
    operator_id: bpy.props.StringProperty()

    def execute(self, context):
        if not guided_menu_action_matches(self.step_id, self.operator_id):
            message = "This menu item does not match the accepted next step"
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        return _execute_next(self, context)


class OPERATINGLINE_OT_back(bpy.types.Operator):
    bl_idname = "operating_line.back"
    bl_label = "Back"
    bl_description = "Compensate the active action-owned plan step"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        session = _session()
        candidate = session.active_step
        if not _prepare_history(self, context, session, "back"):
            return {"CANCELLED"}
        try:
            step = session.back()
        except (OSError, RuntimeError, ValueError) as error:
            return _finish_failed_operation(self, session, candidate, error)
        if step is None:
            cancel_native_history()
            self.report({"INFO"}, "No active step to roll back")
            return {"CANCELLED"}
        if not _commit_history(self, session):
            return {"FINISHED"}
        _companion().report("step_rolled_back", step=step)
        refresh_native_menu_guidance()
        return {"FINISHED"}


class OPERATINGLINE_OT_connect(bpy.types.Operator):
    bl_idname = "operating_line.connect"
    bl_label = "Connect"
    bl_description = "Connect to a loopback OperatingLine runtime"

    def execute(self, context):
        window_manager = context.window_manager
        try:
            _companion().connect(
                window_manager.operating_line_runtime_url,
                window_manager.operating_line_bearer_token,
            )
        except ValueError as error:
            _companion().error = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class OPERATINGLINE_OT_disconnect(bpy.types.Operator):
    bl_idname = "operating_line.disconnect"
    bl_label = "Disconnect"
    bl_description = "Disconnect from the OperatingLine runtime"

    def execute(self, _context):
        _companion().disconnect()
        return {"FINISHED"}


class OPERATINGLINE_OT_submit_goal_request(bpy.types.Operator):
    bl_idname = "operating_line.submit_goal_request"
    bl_label = "Create Guidance"
    bl_description = (
        "Queue this goal for the runtime planner; no plan is accepted or executed"
    )

    def execute(self, context):
        companion = _companion()
        try:
            request = companion.submit_goal_request(
                context.window_manager.operating_line_goal
            )
        except ValueError as error:
            companion.goal_request.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        context.window_manager.operating_line_goal = ""
        self.report(
            {"INFO"},
            f"Goal request {request['requestId'][:8]} queued; scene unchanged",
        )
        return {"FINISHED"}


class OPERATINGLINE_OT_refresh_initial_plan_providers(bpy.types.Operator):
    bl_idname = "operating_line.refresh_initial_plan_providers"
    bl_label = "Refresh Initial Providers"
    bl_description = "Refresh initial planner descriptors from the loopback runtime"

    def execute(self, _context):
        companion = _companion()
        try:
            companion.refresh_initial_plan_providers()
        except ValueError as error:
            companion.initial_plan_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class OPERATINGLINE_OT_select_initial_plan_provider(bpy.types.Operator):
    bl_idname = "operating_line.select_initial_plan_provider"
    bl_label = "Select Initial Provider"
    bl_description = "Explicitly select this provider for a future confirmed initial run"

    provider_id: bpy.props.StringProperty()

    def execute(self, _context):
        companion = _companion()
        try:
            provider = companion.select_initial_plan_provider(self.provider_id)
        except ValueError as error:
            companion.initial_plan_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Selected {provider['displayName']}")
        return {"FINISHED"}


class OPERATINGLINE_OT_run_initial_plan_provider(bpy.types.Operator):
    bl_idname = "operating_line.run_initial_plan_provider"
    bl_label = "Confirm Initial Planner Run"
    bl_description = "Unavailable until signed packet-bound Provider authority is implemented"

    def invoke(self, context, _event):
        handoff = _companion().initial_plan_handoff
        del context
        handoff.message = PROVIDER_AUTHORITY_UNAVAILABLE
        self.report({"ERROR"}, PROVIDER_AUTHORITY_UNAVAILABLE)
        return {"CANCELLED"}

    def draw(self, _context):
        self.layout.label(text=PROVIDER_AUTHORITY_UNAVAILABLE, icon="LOCKED")

    def execute(self, _context):
        companion = _companion()
        companion.initial_plan_handoff.message = PROVIDER_AUTHORITY_UNAVAILABLE
        self.report({"ERROR"}, PROVIDER_AUTHORITY_UNAVAILABLE)
        return {"CANCELLED"}


class OPERATINGLINE_OT_accept_proposal(bpy.types.Operator):
    bl_idname = "operating_line.accept_proposal"
    bl_label = "Accept Plan"
    bl_description = "Accept the reviewed proposal as the active plan without executing it"

    def execute(self, _context):
        companion = _companion()
        if companion.accept_proposal():
            self.report({"INFO"}, "Plan accepted; no step has executed yet")
            return {"FINISHED"}
        self.report({"ERROR"}, companion.error or "Plan proposal could not be accepted")
        return {"CANCELLED"}


class OPERATINGLINE_OT_reject_proposal(bpy.types.Operator):
    bl_idname = "operating_line.reject_proposal"
    bl_label = "Reject Plan"
    bl_description = "Reject the proposal without changing the active plan or scene"

    def execute(self, _context):
        companion = _companion()
        if companion.reject_proposal():
            self.report({"INFO"}, "Plan proposal rejected; active plan preserved")
            return {"FINISHED"}
        self.report({"ERROR"}, companion.error or "No plan proposal is awaiting review")
        return {"CANCELLED"}


class OPERATINGLINE_OT_reference_node(bpy.types.Operator):
    bl_idname = "operating_line.reference_node"
    bl_label = "Reference Node"
    bl_description = "Add this stable task node to an immutable revision request"

    node_id: bpy.props.StringProperty()
    scope: bpy.props.StringProperty()

    def execute(self, _context):
        companion = _companion()
        try:
            node = companion.add_revision_reference(
                self.scope,
                self.node_id,
            )
        except ValueError as error:
            companion.revision_request_status = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        companion.revision_request_status = (
            f"@{node.number} referenced; describe the change"
        )
        return {"FINISHED"}


class OPERATINGLINE_OT_remove_revision_reference(bpy.types.Operator):
    bl_idname = "operating_line.remove_revision_reference"
    bl_label = "Remove Reference"
    bl_description = "Remove this node from the local revision-request draft"

    node_id: bpy.props.StringProperty()

    def execute(self, _context):
        companion = _companion()
        if not companion.remove_revision_reference(self.node_id):
            self.report({"WARNING"}, "Revision reference is no longer selected")
            return {"CANCELLED"}
        companion.revision_request_status = "Reference removed; draft preserved"
        return {"FINISHED"}


_PARAMETER_ENUM_ITEMS_CACHE = {}


def _parameter_enum_items(operator, _context):
    cached = _PARAMETER_ENUM_ITEMS_CACHE.get(operator.enum_values_json)
    if cached is not None:
        return cached
    try:
        values = json.loads(operator.enum_values_json)
    except (TypeError, ValueError):
        values = []
    items = tuple(
        (value, value, f"Use {value}")
        for value in values
        if isinstance(value, str)
    )
    _PARAMETER_ENUM_ITEMS_CACHE[operator.enum_values_json] = items
    return items


class OPERATINGLINE_OT_edit_revision_parameter(bpy.types.Operator):
    bl_idname = "operating_line.edit_revision_parameter"
    bl_label = "Edit Requested Parameter"
    bl_description = (
        "Add a typed parameter edit to the immutable revision request; "
        "this does not modify the active Plan or scene"
    )

    node_id: bpy.props.StringProperty(options={"HIDDEN"})
    argument_name: bpy.props.StringProperty(options={"HIDDEN"})
    value_kind: bpy.props.StringProperty(options={"HIDDEN"})
    vector_length: bpy.props.IntProperty(default=0, min=0, max=4, options={"HIDDEN"})
    enum_values_json: bpy.props.StringProperty(default="[]", options={"HIDDEN"})
    bool_value: bpy.props.BoolProperty(name="Requested value")
    int_value: bpy.props.IntProperty(name="Requested value")
    float_value: bpy.props.FloatProperty(name="Requested value", precision=6)
    enum_value: bpy.props.EnumProperty(name="Requested value", items=_parameter_enum_items)
    vector_value: bpy.props.FloatVectorProperty(
        name="Requested value",
        size=4,
        precision=6,
    )

    def invoke(self, context, _event):
        try:
            field = _companion().revision_parameter_field(
                self.node_id,
                self.argument_name,
            )
        except ValueError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if not field.editable:
            self.report({"ERROR"}, f"{field.name} is read-only in this parameter form")
            return {"CANCELLED"}
        self.value_kind = field.kind
        self.vector_length = field.vector_length
        self.enum_values_json = json.dumps(field.enum_values)
        if field.kind == "boolean":
            self.bool_value = bool(field.value)
        elif field.kind == "integer":
            self.int_value = int(field.value)
        elif field.kind == "number":
            self.float_value = float(field.value)
        elif field.kind == "enum":
            self.enum_value = str(field.value)
        elif field.kind in {"integer_vector", "number_vector"}:
            values = tuple(float(value) for value in field.value)
            self.vector_value = values + (0.0,) * (4 - len(values))
        else:
            self.report({"ERROR"}, f"Unsupported parameter form type: {field.kind}")
            return {"CANCELLED"}
        return context.window_manager.invoke_props_dialog(self, width=420)

    def draw(self, _context):
        layout = self.layout
        layout.label(text=f"{self.node_id}.{self.argument_name}")
        if self.value_kind == "boolean":
            layout.prop(self, "bool_value")
        elif self.value_kind == "integer":
            layout.prop(self, "int_value")
        elif self.value_kind == "number":
            layout.prop(self, "float_value")
        elif self.value_kind == "enum":
            layout.prop(self, "enum_value")
        elif self.value_kind in {"integer_vector", "number_vector"}:
            for index in range(self.vector_length):
                layout.prop(self, "vector_value", index=index, text=f"Value {index + 1}")
        layout.label(text="Request draft only; Plan and scene stay unchanged", icon="INFO")

    def execute(self, _context):
        if self.value_kind == "boolean":
            value = self.bool_value
        elif self.value_kind == "integer":
            value = self.int_value
        elif self.value_kind == "number":
            value = self.float_value
        elif self.value_kind == "enum":
            value = self.enum_value
        elif self.value_kind in {"integer_vector", "number_vector"}:
            values = self.vector_value[: self.vector_length]
            value = (
                [int(round(item)) for item in values]
                if self.value_kind == "integer_vector"
                else [float(item) for item in values]
            )
        else:
            self.report({"ERROR"}, "Unsupported parameter form type")
            return {"CANCELLED"}
        companion = _companion()
        try:
            companion.set_revision_parameter_edit(
                self.node_id,
                self.argument_name,
                value,
            )
        except ValueError as error:
            companion.revision_request_status = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        companion.revision_request_status = (
            f"Structured edit set: {self.argument_name}; Plan and scene unchanged"
        )
        return {"FINISHED"}


class OPERATINGLINE_OT_reset_revision_parameter(bpy.types.Operator):
    bl_idname = "operating_line.reset_revision_parameter"
    bl_label = "Reset Requested Parameter"
    bl_description = "Remove this structured parameter edit from the local draft"

    node_id: bpy.props.StringProperty(options={"HIDDEN"})
    argument_name: bpy.props.StringProperty(options={"HIDDEN"})

    def execute(self, _context):
        companion = _companion()
        if not companion.reset_revision_parameter_edit(
            self.node_id,
            self.argument_name,
        ):
            self.report({"WARNING"}, "Parameter edit is no longer present")
            return {"CANCELLED"}
        companion.revision_request_status = (
            f"Structured edit reset: {self.argument_name}"
        )
        return {"FINISHED"}


class OPERATINGLINE_OT_clear_revision_request(bpy.types.Operator):
    bl_idname = "operating_line.clear_revision_request"
    bl_label = "Clear Request"
    bl_description = "Clear the local revision-request draft without changing the scene"

    def execute(self, context):
        companion = _companion()
        companion.clear_revision_draft()
        companion.revision_request_status = "Revision draft cleared"
        context.window_manager.operating_line_revision_message = ""
        return {"FINISHED"}


class OPERATINGLINE_OT_submit_revision_request(bpy.types.Operator):
    bl_idname = "operating_line.submit_revision_request"
    bl_label = "Send Request"
    bl_description = (
        "Queue an immutable revision request for an external MCP planner; "
        "this does not change the scene"
    )

    def execute(self, context):
        companion = _companion()
        try:
            companion.submit_revision_request(
                context.window_manager.operating_line_revision_message
            )
        except ValueError as error:
            companion.revision_request_status = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        context.window_manager.operating_line_revision_message = ""
        self.report({"INFO"}, "Revision request queued; the scene was not changed")
        return {"FINISHED"}


class OPERATINGLINE_OT_load_older_revision_history(bpy.types.Operator):
    bl_idname = "operating_line.load_older_revision_history"
    bl_label = "Load Older Turns"
    bl_description = "Load the preceding page of this immutable revision thread"

    def execute(self, _context):
        companion = _companion()
        if companion.load_older_revision_history():
            self.report({"INFO"}, "Older revision turns requested")
            return {"FINISHED"}
        self.report({"INFO"}, companion.revision_history_error)
        return {"CANCELLED"}


class OPERATINGLINE_OT_fork_revision_branch(bpy.types.Operator):
    bl_idname = "operating_line.fork_revision_branch"
    bl_label = "Fork Branch"
    bl_description = (
        "Compose the first turn of a new revision branch from the active accepted head"
    )

    def execute(self, _context):
        companion = _companion()
        try:
            companion.begin_revision_fork()
        except ValueError as error:
            companion.revision_request_status = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, "Fork mode selected; choose task references")
        return {"FINISHED"}


class OPERATINGLINE_OT_merge_revision_branch(bpy.types.Operator):
    bl_idname = "operating_line.merge_revision_branch"
    bl_label = "Merge Branch"
    bl_description = (
        "Prepare a deterministic three-way merge from this accepted branch"
    )

    source_thread_id: bpy.props.StringProperty(options={"HIDDEN"})

    def execute(self, _context):
        companion = _companion()
        try:
            companion.begin_revision_merge(self.source_thread_id)
        except ValueError as error:
            companion.revision_request_status = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, "Merge request prepared; scene unchanged")
        return {"FINISHED"}


class OPERATINGLINE_OT_switch_revision_branch(bpy.types.Operator):
    bl_idname = "operating_line.switch_revision_branch"
    bl_label = "Switch Branch"
    bl_description = "Activate this accepted branch head without executing its Plan"

    thread_id: bpy.props.StringProperty(options={"HIDDEN"})

    def execute(self, _context):
        companion = _companion()
        try:
            companion.switch_revision_branch(self.thread_id)
        except ValueError as error:
            companion.revision_branches_error = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Revision branch {self.thread_id[:8]} activated")
        return {"FINISHED"}


class OPERATINGLINE_OT_refresh_replan_providers(bpy.types.Operator):
    bl_idname = "operating_line.refresh_replan_providers"
    bl_label = "Refresh Providers"
    bl_description = "Refresh public provider descriptors from the loopback runtime"

    def execute(self, _context):
        companion = _companion()
        try:
            companion.refresh_replan_providers()
        except ValueError as error:
            companion.provider_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class OPERATINGLINE_OT_select_replan_provider(bpy.types.Operator):
    bl_idname = "operating_line.select_replan_provider"
    bl_label = "Select Provider"
    bl_description = "Explicitly select this provider for a future confirmed run"

    provider_id: bpy.props.StringProperty()

    def execute(self, _context):
        companion = _companion()
        try:
            provider = companion.select_replan_provider(self.provider_id)
        except ValueError as error:
            companion.provider_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Selected {provider['displayName']}")
        return {"FINISHED"}


class OPERATINGLINE_OT_run_replan_provider(bpy.types.Operator):
    bl_idname = "operating_line.run_replan_provider"
    bl_label = "Provider Authority Unavailable"
    bl_description = (
        "Requires a trusted signed ProviderCallAuthorization that this extension "
        "cannot currently obtain"
    )

    def invoke(self, context, _event):
        handoff = _companion().provider_handoff
        if handoff.selected_provider is not None and (
            handoff.acknowledged_revision_request_id is not None
        ):
            handoff.message = PROVIDER_AUTHORITY_UNAVAILABLE
            self.report({"ERROR"}, PROVIDER_AUTHORITY_UNAVAILABLE)
            return {"CANCELLED"}
        if not handoff.can_run:
            message = (
                "Select an available provider after the runtime acknowledges the request"
            )
            handoff.message = message
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        self._confirmation_opened = True
        return context.window_manager.invoke_props_dialog(self, width=520)

    def draw(self, _context):
        handoff = _companion().provider_handoff
        provider = handoff.selected_provider
        layout = self.layout
        if provider is None:
            layout.label(text="No provider selected", icon="ERROR")
            return
        _draw_provider_authorization(layout, provider)

    def execute(self, _context):
        companion = _companion()
        if not getattr(self, "_confirmation_opened", False):
            message = "Open and confirm the provider authorization dialog first"
            companion.provider_handoff.message = message
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        self._confirmation_opened = False
        try:
            request = companion.begin_replan_run()
        except ValueError as error:
            companion.provider_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report(
            {"INFO"},
            f"Provider run {request['generationRequestId'][:8]} queued; scene unchanged",
        )
        return {"FINISHED"}


class OPERATINGLINE_OT_refresh_dialogue_providers(bpy.types.Operator):
    bl_idname = "operating_line.refresh_dialogue_providers"
    bl_label = "Refresh Dialogue Providers"
    bl_description = "Refresh streamed-dialogue provider descriptors from the runtime"

    def execute(self, _context):
        companion = _companion()
        try:
            companion.refresh_dialogue_providers()
        except ValueError as error:
            companion.dialogue_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class OPERATINGLINE_OT_select_dialogue_provider(bpy.types.Operator):
    bl_idname = "operating_line.select_dialogue_provider"
    bl_label = "Select Dialogue Provider"
    bl_description = "Explicitly select the provider for a future confirmed dialogue turn"

    provider_id: bpy.props.StringProperty()

    def execute(self, _context):
        companion = _companion()
        try:
            provider = companion.select_dialogue_provider(self.provider_id)
        except ValueError as error:
            companion.dialogue_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Selected {provider['displayName']}")
        return {"FINISHED"}


class OPERATINGLINE_OT_run_dialogue_provider(bpy.types.Operator):
    bl_idname = "operating_line.run_dialogue_provider"
    bl_label = "Confirm Dialogue Turn"
    bl_description = "Unavailable until signed packet-bound Provider authority is implemented"

    def invoke(self, context, _event):
        companion = _companion()
        handoff = companion.dialogue_handoff
        del context
        handoff.message = PROVIDER_AUTHORITY_UNAVAILABLE
        self.report({"ERROR"}, PROVIDER_AUTHORITY_UNAVAILABLE)
        return {"CANCELLED"}

    def draw(self, _context):
        self.layout.label(text=PROVIDER_AUTHORITY_UNAVAILABLE, icon="LOCKED")

    def execute(self, _context):
        companion = _companion()
        companion.dialogue_handoff.message = PROVIDER_AUTHORITY_UNAVAILABLE
        self.report({"ERROR"}, PROVIDER_AUTHORITY_UNAVAILABLE)
        return {"CANCELLED"}


class OPERATINGLINE_OT_toggle_overlay(bpy.types.Operator):
    bl_idname = "operating_line.toggle_overlay"
    bl_label = "Show or Hide Markers"
    bl_description = "Show or hide editor markers while keeping leaf steps and the task tree visible"

    def execute(self, context):
        if overlay_enabled():
            disable_native_menu_guidance(reset_tracker=False)
            disable_overlay()
            context.window_manager.operating_line_overlay_enabled = False
        else:
            enable_native_menu_guidance(_session)
            enable_overlay(_session, interaction_guidance_snapshot)
            context.window_manager.operating_line_overlay_enabled = True
        return {"FINISHED"}


class OPERATINGLINE_OT_toggle_branch(bpy.types.Operator):
    bl_idname = "operating_line.toggle_branch"
    bl_label = "Toggle Task Branch"

    node_id: bpy.props.StringProperty()

    def execute(self, _context):
        _session().toggle_expanded(self.node_id)
        return {"FINISHED"}


CLASSES = (
    OPERATINGLINE_OT_connect,
    OPERATINGLINE_OT_disconnect,
    OPERATINGLINE_OT_submit_goal_request,
    OPERATINGLINE_OT_refresh_initial_plan_providers,
    OPERATINGLINE_OT_select_initial_plan_provider,
    OPERATINGLINE_OT_run_initial_plan_provider,
    OPERATINGLINE_OT_accept_proposal,
    OPERATINGLINE_OT_reject_proposal,
    OPERATINGLINE_OT_reference_node,
    OPERATINGLINE_OT_remove_revision_reference,
    OPERATINGLINE_OT_edit_revision_parameter,
    OPERATINGLINE_OT_reset_revision_parameter,
    OPERATINGLINE_OT_clear_revision_request,
    OPERATINGLINE_OT_submit_revision_request,
    OPERATINGLINE_OT_load_older_revision_history,
    OPERATINGLINE_OT_fork_revision_branch,
    OPERATINGLINE_OT_merge_revision_branch,
    OPERATINGLINE_OT_switch_revision_branch,
    OPERATINGLINE_OT_refresh_replan_providers,
    OPERATINGLINE_OT_select_replan_provider,
    OPERATINGLINE_OT_run_replan_provider,
    OPERATINGLINE_OT_refresh_dialogue_providers,
    OPERATINGLINE_OT_select_dialogue_provider,
    OPERATINGLINE_OT_run_dialogue_provider,
    OPERATINGLINE_OT_start,
    OPERATINGLINE_OT_next,
    OPERATINGLINE_OT_execution_track_managed_commit,
    OPERATINGLINE_OT_leaf_operation_back,
    OPERATINGLINE_OT_leaf_operation_next,
    OPERATINGLINE_OT_leaf_operation_retry,
    OPERATINGLINE_OT_edit_guided_geometry_parameter,
    OPERATINGLINE_OT_highlight_guided_geometry_parameter,
    OPERATINGLINE_OT_execute_guided_geometry_operation,
    OPERATINGLINE_OT_undo_guided_geometry_operation,
    OPERATINGLINE_OT_abort_guided_geometry_operations,
    OPERATINGLINE_OT_execute_guided_geometry_leaf,
    OPERATINGLINE_OT_verify_execution_track,
    OPERATINGLINE_OT_recheck_observations,
    OPERATINGLINE_OT_open_add_menu,
    OPERATINGLINE_OT_guided_menu_action,
    OPERATINGLINE_OT_back,
    OPERATINGLINE_OT_toggle_overlay,
    OPERATINGLINE_OT_toggle_branch,
)
