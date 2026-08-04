"""OperatingLine Blender extension entry point."""

import bpy

from .application import DemoSession
from .application.companion import CompanionController
from .domain import SNOWMAN_PLAN_ID, SNOWMAN_PLAN_REVISION, SNOWMAN_TASK_TREE
from .infrastructure import (
    action_registry,
    disable_overlay,
    forget_managed_collection,
)
from .presentation import CLASSES

_session: DemoSession | None = None
_companion: CompanionController | None = None


def get_session() -> DemoSession:
    global _session
    if _session is None:
        _session = DemoSession(
            SNOWMAN_TASK_TREE,
            action_registry(SNOWMAN_TASK_TREE),
            plan_id=SNOWMAN_PLAN_ID,
            revision=SNOWMAN_PLAN_REVISION,
        )
    return _session


def replace_session(replacement: DemoSession) -> None:
    """Install a validated session without mutating the Blender scene."""
    global _session
    if _session is not None and _session.receipts:
        raise ValueError(
            "A plan update is pending; use Back to roll the walkthrough to its start first"
        )
    _session = replacement


def get_companion() -> CompanionController:
    global _companion
    if _companion is None:
        _companion = CompanionController()
    return _companion


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
    if _session is None:
        _session = DemoSession(
            SNOWMAN_TASK_TREE,
            action_registry(SNOWMAN_TASK_TREE),
            plan_id=SNOWMAN_PLAN_ID,
            revision=SNOWMAN_PLAN_REVISION,
        )
    get_companion().register_timer()


def unregister() -> None:
    global _companion, _session
    if _companion is not None:
        _companion.unregister_timer()
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
    ):
        if hasattr(bpy.types.WindowManager, property_name):
            delattr(bpy.types.WindowManager, property_name)
    for cls in reversed(CLASSES):
        if getattr(cls, "is_registered", False):
            bpy.utils.unregister_class(cls)
    if reset_completed:
        _session = None
    _companion = None
