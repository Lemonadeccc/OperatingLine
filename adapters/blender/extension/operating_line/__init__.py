"""OperatingLine Blender extension entry point."""

import bpy

from .application import DemoSession
from .domain import SNOWMAN_TASK_TREE
from .infrastructure import (
    action_registry,
    disable_overlay,
    forget_managed_collection,
)
from .presentation import CLASSES

_session: DemoSession | None = None


def get_session() -> DemoSession:
    global _session
    if _session is None:
        _session = DemoSession(SNOWMAN_TASK_TREE, action_registry(SNOWMAN_TASK_TREE))
    return _session


def register() -> None:
    global _session
    for cls in CLASSES:
        if not getattr(cls, "is_registered", False):
            bpy.utils.register_class(cls)
    if not hasattr(bpy.types.Scene, "operating_line_overlay_enabled"):
        bpy.types.Scene.operating_line_overlay_enabled = bpy.props.BoolProperty(default=False)
    if not hasattr(bpy.types.Scene, "operating_line_replace_factory_scene"):
        bpy.types.Scene.operating_line_replace_factory_scene = bpy.props.BoolProperty(
            name="Delete factory Cube/Camera/Light on Start",
            description=(
                "Explicitly allow Start to delete the recognized factory startup trio; "
                "disabled by default to protect user data"
            ),
            default=False,
        )
    if _session is None:
        _session = DemoSession(SNOWMAN_TASK_TREE, action_registry(SNOWMAN_TASK_TREE))


def unregister() -> None:
    global _session
    disable_overlay()
    if _session is not None:
        _session.reset()
    forget_managed_collection()
    for property_name in (
        "operating_line_overlay_enabled",
        "operating_line_replace_factory_scene",
    ):
        if hasattr(bpy.types.Scene, property_name):
            delattr(bpy.types.Scene, property_name)
    for cls in reversed(CLASSES):
        if getattr(cls, "is_registered", False):
            bpy.utils.unregister_class(cls)
    _session = None
