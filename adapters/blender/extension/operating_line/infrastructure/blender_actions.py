"""Compatibility facade for the step-keyed Blender action implementation."""

from ..application import ActionReceipt
from ..domain import TaskNode
from .snowman_actions import (
    build_action_registry,
    build_resource_registry,
    find_artifact,
    resolve_receipt_anchor,
    resolve_resource,
    rollback_receipt,
)


def action_registry(root: TaskNode):
    return build_action_registry(root)


def resolve_receipt_object(receipt: ActionReceipt):
    return resolve_receipt_anchor(receipt)


def forget_managed_collection() -> None:
    """Retained for extension lifecycle compatibility; ownership is receipt-based."""


__all__ = (
    "action_registry",
    "build_resource_registry",
    "find_artifact",
    "forget_managed_collection",
    "resolve_receipt_anchor",
    "resolve_receipt_object",
    "resolve_resource",
    "rollback_receipt",
)
