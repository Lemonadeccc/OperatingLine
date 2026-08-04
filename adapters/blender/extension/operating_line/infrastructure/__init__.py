"""Blender-facing infrastructure implementations."""

from .blender_actions import (
    action_registry,
    build_resource_registry,
    find_artifact,
    forget_managed_collection,
    resolve_receipt_anchor,
    resolve_resource,
)
from .companion_transport import CompanionTransport, validate_companion_url
from .overlay import disable_overlay, enable_overlay, overlay_enabled
from .scene_preparation import remove_factory_startup_objects

__all__ = (
    "action_registry",
    "build_resource_registry",
    "CompanionTransport",
    "disable_overlay",
    "enable_overlay",
    "overlay_enabled",
    "forget_managed_collection",
    "find_artifact",
    "remove_factory_startup_objects",
    "resolve_receipt_anchor",
    "resolve_resource",
    "validate_companion_url",
)
