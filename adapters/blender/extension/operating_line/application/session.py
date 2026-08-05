"""Use-case state and traversal for a validated guide plan."""

from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass
import hashlib
import math
import re
import struct
from typing import Any
import uuid

from ..domain import TaskNode, executable_steps


def _length_delimited(value: bytes) -> bytes:
    return str(len(value)).encode("ascii") + b":" + value


def _valid_unicode_bytes(value: str) -> bytes:
    try:
        return value.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise ValueError(
            "Canonical JSON strings must contain valid Unicode"
        ) from error


def _canonical_json_value_bytes(value: Any, ancestors: set[int]) -> bytes:
    if value is None:
        return b"n"
    if value is False:
        return b"f"
    if value is True:
        return b"t"
    if isinstance(value, (int, float)):
        try:
            number = float(value)
        except OverflowError as error:
            raise ValueError("Canonical JSON numbers must be finite") from error
        if not math.isfinite(number):
            raise ValueError("Canonical JSON numbers must be finite")
        if number == 0:
            number = 0.0
        return b"d" + struct.pack(">d", number).hex().encode("ascii")
    if isinstance(value, str):
        encoded = _valid_unicode_bytes(value)
        return b"s" + str(len(encoded)).encode("ascii") + b":" + encoded
    if not isinstance(value, (list, dict)):
        raise ValueError("Value is not a JSON value")
    identity = id(value)
    if identity in ancestors:
        raise ValueError("Canonical JSON values must not contain cycles")
    ancestors.add(identity)
    try:
        if isinstance(value, list):
            items = [
                _length_delimited(_canonical_json_value_bytes(item, ancestors))
                for item in value
            ]
            return b"a" + str(len(value)).encode("ascii") + b":" + b"".join(items)
        entries: list[tuple[bytes, Any]] = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("Canonical JSON object keys must be strings")
            entries.append((_valid_unicode_bytes(key), item))
        entries.sort(key=lambda entry: entry[0])
        parts = [b"o" + str(len(entries)).encode("ascii") + b":"]
        for key_bytes, item in entries:
            encoded_key = (
                b"s"
                + str(len(key_bytes)).encode("ascii")
                + b":"
                + key_bytes
            )
            parts.append(_length_delimited(encoded_key))
            parts.append(
                _length_delimited(_canonical_json_value_bytes(item, ancestors))
            )
        return b"".join(parts)
    finally:
        ancestors.remove(identity)


def canonical_plan_content_sha256(plan: Mapping[str, Any]) -> str:
    """Hash a semantic JSON plan identically across JavaScript and Python."""
    return hashlib.sha256(_canonical_json_value_bytes(dict(plan), set())).hexdigest()


@dataclass(frozen=True, slots=True)
class ParentIdentity:
    """Exact Blender container identity for an owned Collection link."""

    resource_type: str
    session_uid: int


@dataclass(frozen=True, slots=True)
class ResourceIdentity:
    """Exact identity of one Blender ID created by an action."""

    resource_type: str
    logical_id: str
    display_name: str
    pointer: int
    receipt_token: str
    step_id: str = ""
    action_name: str = ""
    parent_links: tuple[ParentIdentity, ...] = ()


@dataclass(frozen=True, slots=True)
class MutationRecord:
    """A compare-and-restore mutation made to a resource owned by this guide."""

    resource: ResourceIdentity
    attribute: str
    before: Any
    after: Any


@dataclass(frozen=True, slots=True)
class ArtifactIdentity:
    """A file artifact created by an action."""

    logical_id: str
    path: str
    sha256: str
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class ActionReceipt:
    """All reversible effects produced by one executable plan step."""

    receipt_id: str
    step_id: str
    action_name: str
    created: tuple[ResourceIdentity, ...] = ()
    mutations: tuple[MutationRecord, ...] = ()
    artifacts: tuple[ArtifactIdentity, ...] = ()
    anchor: ResourceIdentity | None = None

    # Compatibility properties for the original one-object snowman slice.
    @property
    def rollback_token(self) -> str:
        return self.anchor.receipt_token if self.anchor is not None else self.receipt_id

    @property
    def display_name(self) -> str:
        return self.anchor.display_name if self.anchor is not None else self.action_name

    @property
    def object_pointer(self) -> int:
        return self.anchor.pointer if self.anchor is not None else 0

    @property
    def collection_pointer(self) -> int:
        for resource in self.created:
            if resource.resource_type == "COLLECTION":
                return resource.pointer
        return 0


ExecuteAction = Callable[[Mapping[str, ActionReceipt]], ActionReceipt]
RollbackAction = Callable[[ActionReceipt], None]


class DemoSession:
    def __init__(
        self,
        root: TaskNode,
        actions: Mapping[str, tuple[ExecuteAction, RollbackAction]],
        *,
        plan_id: str | None = "snowman-demo",
        revision: int | None = 1,
        source_plan: Mapping[str, Any] | None = None,
        plan_content_sha256: str | None = None,
    ) -> None:
        self.root = root
        self._actions = actions
        self.plan_id = plan_id
        self.revision = revision
        if plan_content_sha256 is not None and re.fullmatch(
            r"[0-9a-f]{64}", plan_content_sha256
        ) is None:
            raise ValueError("Plan content SHA-256 must be 64 lowercase hex characters")
        self._source_plan = deepcopy(dict(source_plan)) if source_plan is not None else None
        if self._source_plan is not None and (
            self._source_plan.get("id") != plan_id
            or self._source_plan.get("revision") != revision
        ):
            raise ValueError("Session source plan identity does not match plan id/revision")
        expected_plan_content_sha256 = (
            canonical_plan_content_sha256(self._source_plan)
            if self._source_plan is not None
            else None
        )
        if (
            plan_content_sha256 is not None
            and plan_content_sha256 != expected_plan_content_sha256
        ):
            raise ValueError("Plan content SHA-256 does not match the source plan")
        self.plan_content_sha256 = (
            plan_content_sha256 or expected_plan_content_sha256
        )
        self.execution_id: str | None = None
        self.steps = executable_steps(root)
        self.active_index = -1
        self.started = False
        self.receipts: dict[str, ActionReceipt] = {}
        self._branch_node_ids = self._branch_ids(root)
        self.expanded_node_ids = set(self._branch_node_ids)
        self._nodes_by_id = self._index_nodes(root)

    @staticmethod
    def _index_nodes(root: TaskNode) -> dict[str, TaskNode]:
        nodes: dict[str, TaskNode] = {}

        def visit(node: TaskNode) -> None:
            nodes[node.id] = node
            for child in node.children:
                visit(child)

        visit(root)
        return nodes

    def find_node(self, node_id: str) -> TaskNode | None:
        return self._nodes_by_id.get(node_id)

    def source_plan_copy(self) -> dict[str, Any] | None:
        return deepcopy(self._source_plan)

    @staticmethod
    def _branch_ids(root: TaskNode) -> set[str]:
        branch_ids: set[str] = set()

        def visit(node: TaskNode) -> None:
            if node.children:
                branch_ids.add(node.id)
            for child in node.children:
                visit(child)

        visit(root)
        return branch_ids

    @property
    def active_step(self) -> TaskNode | None:
        if 0 <= self.active_index < len(self.steps):
            return self.steps[self.active_index]
        return None

    def start(self) -> None:
        self.reset()
        self.execution_id = str(uuid.uuid4())
        self.started = True

    def _step_actions(self, step: TaskNode) -> tuple[ExecuteAction, RollbackAction]:
        return self._actions[step.id]

    def next(self) -> TaskNode | None:
        if not self.started:
            self.start()
        next_index = self.active_index + 1
        if next_index >= len(self.steps):
            return None
        step = self.steps[next_index]
        execute, _rollback = self._step_actions(step)
        receipt = execute(self.receipts)
        action_name = step.action.name if step.action else ""
        if receipt.step_id != step.id or receipt.action_name != action_name:
            raise RuntimeError(f"Action returned a receipt for the wrong step: {step.id}")
        self.receipts[step.id] = receipt
        self.active_index = next_index
        return step

    def back(self) -> TaskNode | None:
        step = self.active_step
        if step is None:
            return None
        _execute, rollback = self._step_actions(step)
        receipt = self.receipts.get(step.id)
        if receipt is not None:
            rollback(receipt)
            del self.receipts[step.id]
        self.active_index -= 1
        return step

    def is_expanded(self, node_id: str) -> bool:
        return node_id in self.expanded_node_ids

    def toggle_expanded(self, node_id: str) -> None:
        if node_id not in self._branch_node_ids:
            return
        if node_id in self.expanded_node_ids:
            self.expanded_node_ids.remove(node_id)
        else:
            self.expanded_node_ids.add(node_id)

    def reset(self) -> None:
        while self.active_step is not None:
            self.back()
        self.receipts.clear()
        self.active_index = -1
        self.started = False
        self.execution_id = None
