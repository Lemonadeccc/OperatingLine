"""Use-case state and traversal for the bundled snowman demo."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from ..domain import TaskNode, executable_steps


@dataclass(frozen=True, slots=True)
class ActionReceipt:
    """Stable identity for one adapter mutation, independent of display names."""

    action_name: str
    display_name: str
    rollback_token: str
    object_pointer: int
    collection_pointer: int


ExecuteAction = Callable[[], ActionReceipt]
RollbackAction = Callable[[ActionReceipt], None]


class DemoSession:
    def __init__(
        self,
        root: TaskNode,
        actions: Mapping[str, tuple[ExecuteAction, RollbackAction]],
    ) -> None:
        self.root = root
        self._actions = actions
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

    def next(self) -> TaskNode | None:
        if not self.started:
            self.start()
        next_index = self.active_index + 1
        if next_index >= len(self.steps):
            return None
        step = self.steps[next_index]
        action_name = step.action.name if step.action else ""
        execute, _rollback = self._actions[action_name]
        self.receipts[action_name] = execute()
        self.active_index = next_index
        return step

    def back(self) -> TaskNode | None:
        step = self.active_step
        if step is None:
            return None
        action_name = step.action.name if step.action else ""
        _execute, rollback = self._actions[action_name]
        receipt = self.receipts.pop(action_name, None)
        if receipt is not None:
            rollback(receipt)
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
