"""Blender-facing infrastructure implementations."""

from .blender_actions import action_registry, forget_managed_collection
from .companion_transport import CompanionTransport, validate_companion_url
from .overlay import disable_overlay, enable_overlay, overlay_enabled
from .scene_preparation import remove_factory_startup_objects

__all__ = (
    "action_registry",
    "CompanionTransport",
    "disable_overlay",
    "enable_overlay",
    "overlay_enabled",
    "forget_managed_collection",
    "remove_factory_startup_objects",
    "validate_companion_url",
)
