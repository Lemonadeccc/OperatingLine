"""OperatingLine Blender extension entry point."""

import bpy
import uuid

from .application import DemoSession
from .application.companion import CompanionController
from .domain import (
    SNOWMAN_PLAN_ID,
    SNOWMAN_PLAN_REVISION,
    SNOWMAN_TASK_TREE,
    bundled_plan_data,
)
from .infrastructure import (
    NativeHistoryRestore,
    action_registry,
    disable_overlay,
    discard_native_history,
    forget_managed_collection,
    register_native_history,
    register_shortcut_history,
    unregister_native_history,
    unregister_shortcut_history,
)
from .infrastructure.observations import evaluate_observations
from .presentation import CLASSES
from .presentation.native_menu_guidance import (
    disable_native_menu_guidance,
    enable_native_menu_guidance,
    reset_native_menu_guidance,
)
from .presentation.native_menu_guidance import interaction_guidance_snapshot

_session: DemoSession | None = None
_companion: CompanionController | None = None
_COMPANION_INSTANCE_ID_SLOT = "operating_line_companion_instance_id"


def _runtime_namespace() -> dict:
    namespace = getattr(bpy.app, "driver_namespace", None)
    if not isinstance(namespace, dict):
        raise RuntimeError("Blender process runtime namespace is unavailable")
    return namespace


def _companion_instance_id(*, rotate: bool = False) -> str:
    namespace = _runtime_namespace()
    candidate = None if rotate else namespace.get(_COMPANION_INSTANCE_ID_SLOT)
    try:
        parsed = uuid.UUID(str(candidate))
        if str(parsed) != candidate:
            raise ValueError
    except (AttributeError, TypeError, ValueError):
        candidate = str(uuid.uuid4())
        namespace[_COMPANION_INSTANCE_ID_SLOT] = candidate
    return candidate


def get_session() -> DemoSession:
    global _session
    if _session is None:
        _session = DemoSession(
            SNOWMAN_TASK_TREE,
            action_registry(SNOWMAN_TASK_TREE),
            plan_id=SNOWMAN_PLAN_ID,
            revision=SNOWMAN_PLAN_REVISION,
            source_plan=bundled_plan_data(),
            observation_evaluator=evaluate_observations,
        )
    return _session


def replace_session(replacement: DemoSession) -> None:
    """Install a validated session without mutating the Blender scene."""
    global _session
    if _session is not None and _session.receipts:
        raise ValueError(
            "A plan update is pending; use Back to roll the walkthrough to its start first"
        )
    discard_native_history()
    _session = replacement
    reset_native_menu_guidance()


def get_companion() -> CompanionController:
    global _companion
    if _companion is None:
        _companion = CompanionController(_companion_instance_id())
    return _companion


def _native_history_restored(restore: NativeHistoryRestore) -> None:
    """Refresh guide reporting after Blender has restored a checkpoint."""
    session = get_session()
    reset_native_menu_guidance()
    companion = get_companion()
    before = restore.before
    after = restore.after

    if after.started and not before.started:
        enable_native_menu_guidance(get_session)
        enable_overlay(get_session, interaction_guidance_snapshot)
        for window_manager in bpy.data.window_managers:
            if hasattr(window_manager, "operating_line_overlay_enabled"):
                window_manager.operating_line_overlay_enabled = True
    elif not after.started and before.started:
        disable_native_menu_guidance()
        disable_overlay()
        for window_manager in bpy.data.window_managers:
            if hasattr(window_manager, "operating_line_overlay_enabled"):
                window_manager.operating_line_overlay_enabled = False

    try:
        if after.execution_id != before.execution_id:
            companion.report("walkthrough_started" if after.started else "plan_loaded")
            return
        gate = after.observation_gate
        if gate is not None and gate.status != "recovered":
            step = session.find_node(gate.step_id)
            companion.report(
                "step_observation_failed",
                step=step,
                observations_override=gate.observation_copy(),
                observation_gate_override=gate,
            )
            return
        if gate is not None and gate.status == "recovered":
            step = session.find_node(gate.step_id)
            companion.report(
                "observation_recovered",
                step=step,
                observations_override=gate.observation_copy(),
                observation_gate_override=gate,
            )
            return
        if after.active_index < before.active_index:
            step = session.steps[before.active_index]
            companion.report("step_rolled_back", step=step)
            return
        if after.active_index > before.active_index:
            step = session.steps[after.active_index]
            companion.report("step_succeeded", step=step)
            return
        companion.report("walkthrough_started" if after.started else "plan_loaded")
    except (IndexError, OSError, RuntimeError, ValueError) as error:
        companion.error = f"Native Undo reporting failed: {error}"


def _native_history_file_loaded() -> None:
    global _companion
    rotated_instance_id = _companion_instance_id(rotate=True)
    disable_native_menu_guidance()
    disable_overlay()
    reset_native_menu_guidance()
    if _companion is not None:
        previous = _companion
        previous.unregister_timer(document_replaced=True)
        _companion = CompanionController(rotated_instance_id)
        _companion.register_timer()


def register() -> None:
    global _session
    for cls in CLASSES:
        if not getattr(cls, "is_registered", False):
            bpy.utils.register_class(cls)
    if not hasattr(bpy.types.Scene, "operating_line_replace_factory_scene"):
        bpy.types.Scene.operating_line_replace_factory_scene = bpy.props.BoolProperty(
            name="Delete factory Cube/Camera/Light on Start",
            description=(
                "Explicitly allow Start to delete the recognized factory startup trio; "
                "disabled by default to protect user data"
            ),
            default=False,
        )
    if not hasattr(bpy.types.WindowManager, "operating_line_overlay_enabled"):
        bpy.types.WindowManager.operating_line_overlay_enabled = bpy.props.BoolProperty(
            name="Guidance visible",
            description="Show the OperatingLine viewport guidance and task details",
            default=False,
            options={"SKIP_SAVE"},
        )
    if not hasattr(bpy.types.WindowManager, "operating_line_runtime_url"):
        bpy.types.WindowManager.operating_line_runtime_url = bpy.props.StringProperty(
            name="Runtime URL",
            description="Loopback URL of the OperatingLine runtime",
            default="http://127.0.0.1:43123",
            options={"SKIP_SAVE"},
        )
    if not hasattr(bpy.types.WindowManager, "operating_line_bearer_token"):
        bpy.types.WindowManager.operating_line_bearer_token = bpy.props.StringProperty(
            name="Bearer token",
            description="Runtime access token (kept only for this Blender process)",
            subtype="PASSWORD",
            options={"SKIP_SAVE"},
        )
    if not hasattr(bpy.types.WindowManager, "operating_line_revision_message"):
        bpy.types.WindowManager.operating_line_revision_message = bpy.props.StringProperty(
            name="Requested change",
            description=(
                "Describe a change to the referenced task nodes; sending creates "
                "an immutable request and does not change the scene"
            ),
            default="",
            maxlen=4000,
            options={"SKIP_SAVE"},
        )
    if not hasattr(bpy.types.WindowManager, "operating_line_goal"):
        bpy.types.WindowManager.operating_line_goal = bpy.props.StringProperty(
            name="Goal",
            description="Describe the result for a new review-gated guidance plan",
            default="",
            maxlen=10000,
            options={"SKIP_SAVE"},
        )
    if not hasattr(
        bpy.types.WindowManager,
        "operating_line_goal_workspace_expanded",
    ):
        bpy.types.WindowManager.operating_line_goal_workspace_expanded = (
            bpy.props.BoolProperty(
                name="Goal to Guidance expanded",
                description="Show initial goal entry or its current delivery status",
                default=True,
                options={"SKIP_SAVE"},
            )
        )
    if not hasattr(
        bpy.types.WindowManager,
        "operating_line_revision_history_expanded",
    ):
        bpy.types.WindowManager.operating_line_revision_history_expanded = (
            bpy.props.BoolProperty(
                name="Show all loaded revision turns",
                description="Expand every revision turn already loaded from the runtime",
                default=False,
                options={"SKIP_SAVE"},
            )
        )
    if not hasattr(
        bpy.types.WindowManager,
        "operating_line_revision_workspace_expanded",
    ):
        bpy.types.WindowManager.operating_line_revision_workspace_expanded = (
            bpy.props.BoolProperty(
                name="Revision Workspace expanded",
                description=(
                    "Show revision references, immutable thread history, and plan review"
                ),
                default=True,
                options={"SKIP_SAVE"},
            )
        )
    if _session is None:
        _session = DemoSession(
            SNOWMAN_TASK_TREE,
            action_registry(SNOWMAN_TASK_TREE),
            plan_id=SNOWMAN_PLAN_ID,
            revision=SNOWMAN_PLAN_REVISION,
            source_plan=bundled_plan_data(),
            observation_evaluator=evaluate_observations,
        )
    register_native_history(
        get_session,
        _native_history_restored,
        _native_history_file_loaded,
    )
    register_shortcut_history()
    get_companion().register_timer()


def unregister() -> None:
    global _companion, _session
    if _companion is not None:
        _companion.unregister_timer()
    unregister_shortcut_history()
    unregister_native_history()
    disable_native_menu_guidance()
    disable_overlay()
    reset_completed = True
    if _session is not None:
        try:
            _session.reset()
        except (OSError, RuntimeError, ValueError) as error:
            reset_completed = False
            print(
                "OperatingLine kept conflicted resources and their rollback "
                f"receipts during unregister: {error}"
            )
    forget_managed_collection()
    for property_name in ("operating_line_replace_factory_scene",):
        if hasattr(bpy.types.Scene, property_name):
            delattr(bpy.types.Scene, property_name)
    for property_name in (
        "operating_line_overlay_enabled",
        "operating_line_runtime_url",
        "operating_line_bearer_token",
        "operating_line_revision_message",
        "operating_line_goal",
        "operating_line_goal_workspace_expanded",
        "operating_line_revision_history_expanded",
        "operating_line_revision_workspace_expanded",
    ):
        if hasattr(bpy.types.WindowManager, property_name):
            delattr(bpy.types.WindowManager, property_name)
    for cls in reversed(CLASSES):
        if getattr(cls, "is_registered", False):
            bpy.utils.unregister_class(cls)
    if reset_completed:
        _session = None
    _companion = None
