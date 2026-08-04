"""Use-case state and traversal for a validated guide plan."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from ..domain import TaskNode, executable_steps


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
    ) -> None:
        self.root = root
        self._actions = actions
        self.plan_id = plan_id
        self.revision = revision
        self.steps = executable_steps(root)
        self.active_index = -1
        self.started = False
        self.receipts: dict[str, ActionReceipt] = {}
        self._branch_node_ids = self._branch_ids(root)
        self.expanded_node_ids = set(self._branch_node_ids)

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
