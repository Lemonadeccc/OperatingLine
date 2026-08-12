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
from .native_history import (
    NativeHistoryRestore,
    cancel_native_history,
    commit_native_history,
    discard_native_history,
    native_history_error,
    prepare_native_history,
    prepared_native_history_changed,
    register_native_history,
    unregister_native_history,
)
from .overlay import disable_overlay, enable_overlay, overlay_enabled
from .scene_preparation import remove_factory_startup_objects

__all__ = (
    "action_registry",
    "build_resource_registry",
    "cancel_native_history",
    "commit_native_history",
    "CompanionTransport",
    "disable_overlay",
    "enable_overlay",
    "overlay_enabled",
    "forget_managed_collection",
    "find_artifact",
    "discard_native_history",
    "native_history_error",
    "NativeHistoryRestore",
    "prepare_native_history",
    "prepared_native_history_changed",
    "register_native_history",
    "remove_factory_startup_objects",
    "resolve_receipt_anchor",
    "resolve_resource",
    "unregister_native_history",
    "validate_companion_url",
)
