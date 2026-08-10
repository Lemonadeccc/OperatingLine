"""Deterministic microsteps for version-tested Blender native menu paths."""

from dataclasses import dataclass

from ..domain import TaskNode
from .guidance import GuidanceState


_ALLOWLISTED_MESH_PATHS: dict[tuple[str, tuple[str, ...]], str] = {
    (
        "mesh.primitive_plane_add",
        ("Add", "Mesh", "Plane"),
    ): "Plane",
    (
        "mesh.primitive_uv_sphere_add",
        ("Add", "Mesh", "UV Sphere"),
    ): "UV Sphere",
}


@dataclass(frozen=True, slots=True)
class MenuGuidanceItem:
    """One visible microstep inside an executable task-tree leaf."""

    ordinal: int
    label: str
    state: GuidanceState


@dataclass(frozen=True, slots=True)
class MenuGuidanceSnapshot:
    """Current state of one allowlisted native menu path."""

    step_id: str
    operator_id: str
    revealed_depth: int
    items: tuple[MenuGuidanceItem, ...]

    def collapsed_ordinals(self, label: str) -> tuple[int, ...]:
        """Return this label and all still-nested ordinals for a closed menu."""

        index = next(
            (item_index for item_index, item in enumerate(self.items) if item.label == label),
            -1,
        )
        if index < 0:
            return ()
        return tuple(item.ordinal for item in self.items[index:])

    def accepts(self, operator_id: str) -> bool:
        """Whether a native final menu item matches the accepted leaf exactly."""

        return operator_id == self.operator_id


def _operator_anchor(step: TaskNode) -> tuple[str, tuple[str, ...]] | None:
    for anchor in step.anchors:
        if anchor.get("kind") != "operator":
            continue
        operator_id = anchor.get("operatorId")
        menu_path = anchor.get("menuPath")
        if not isinstance(operator_id, str) or not operator_id:
            continue
        if not isinstance(menu_path, list) or not all(
            isinstance(item, str) and item for item in menu_path
        ):
            continue
        return operator_id, tuple(menu_path)
    return None


def _target_for_step(step: TaskNode) -> tuple[str, tuple[str, ...]] | None:
    anchor = _operator_anchor(step)
    if anchor is None or anchor not in _ALLOWLISTED_MESH_PATHS:
        return None
    operator_id, menu_path = anchor
    expected_label = _ALLOWLISTED_MESH_PATHS[anchor]
    if menu_path[-1] != expected_label:
        return None
    return operator_id, ("Layout", *menu_path)


class MenuGuidanceTracker:
    """Keep transient menu reveal depth separate from executable plan state."""

    def __init__(self) -> None:
        self._step_id: str | None = None
        self._revealed_depth = 1

    def reset(self) -> None:
        self._step_id = None
        self._revealed_depth = 1

    def snapshot(self, step: TaskNode | None) -> MenuGuidanceSnapshot | None:
        if step is None:
            self.reset()
            return None
        target = _target_for_step(step)
        if target is None:
            self.reset()
            return None
        if self._step_id != step.id:
            self._step_id = step.id
            self._revealed_depth = 1
        operator_id, labels = target
        items: list[MenuGuidanceItem] = []
        for index, label in enumerate(labels):
            if index < self._revealed_depth - 1:
                state = GuidanceState.COMPLETED
            elif index == self._revealed_depth - 1:
                state = GuidanceState.BACK
            elif index == self._revealed_depth:
                state = GuidanceState.NEXT
            else:
                state = GuidanceState.LOCKED
            items.append(MenuGuidanceItem(index + 1, label, state))
        return MenuGuidanceSnapshot(
            step_id=step.id,
            operator_id=operator_id,
            revealed_depth=self._revealed_depth,
            items=tuple(items),
        )

    def reveal(self, step: TaskNode, label: str) -> bool:
        target = _target_for_step(step)
        if target is None:
            return False
        if self._step_id is None:
            self.snapshot(step)
        if self._step_id != step.id:
            return False
        labels = target[1]
        try:
            label_index = labels.index(label)
        except ValueError:
            return False
        if label_index not in {1, 2}:
            return False
        self._revealed_depth = max(self._revealed_depth, label_index + 1)
        return True


__all__ = (
    "MenuGuidanceItem",
    "MenuGuidanceSnapshot",
    "MenuGuidanceTracker",
)
