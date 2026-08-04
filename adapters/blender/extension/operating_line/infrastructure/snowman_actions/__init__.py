"""Validated, reversible Blender action handlers for the snowman guide."""

from .common import (
    build_resource_registry,
    find_artifact,
    resolve_receipt_anchor,
    resolve_resource,
    rollback_receipt,
)
from .registry import build_action_registry

__all__ = (
    "build_action_registry",
    "build_resource_registry",
    "find_artifact",
    "resolve_receipt_anchor",
    "resolve_resource",
    "rollback_receipt",
)
