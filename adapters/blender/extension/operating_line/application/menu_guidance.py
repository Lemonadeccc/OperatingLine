"""Deterministic microsteps resolved from the Blender InteractionCatalog."""

from dataclasses import dataclass
from enum import Enum

from ..domain import TaskNode
from .guidance import GuidanceState
from .interaction_catalog import (
    BUNDLED_INTERACTION_CATALOG,
    InteractionCatalog,
    InteractionPathKind,
    InteractionRecipe,
)


class MenuGuidanceRole(str, Enum):
    """Navigation role for a non-mutating native-menu microstep."""

    COMPLETED = "completed"
    PREVIOUS = "previous"
    CURRENT = "current"
    NEXT = "next"
    LOCKED = "locked"


_ROLE_STATES = {
    MenuGuidanceRole.COMPLETED: GuidanceState.COMPLETED,
    MenuGuidanceRole.PREVIOUS: GuidanceState.BACK,
    MenuGuidanceRole.CURRENT: GuidanceState.COMPLETED,
    MenuGuidanceRole.NEXT: GuidanceState.NEXT,
    MenuGuidanceRole.LOCKED: GuidanceState.LOCKED,
}


@dataclass(frozen=True, slots=True)
class MenuGuidanceItem:
    """One visible microstep inside an executable task-tree leaf."""

    ordinal: int
    step_id: str
    label: str
    intent: str
    target_kind: str
    target_id: str
    role: MenuGuidanceRole

    @property
    def state(self) -> GuidanceState:
        """Map the menu role onto the shared visual color tokens."""

        return _ROLE_STATES[self.role]


@dataclass(frozen=True, slots=True)
class MenuGuidanceSnapshot:
    """Current state of one catalog-owned native or semantic path."""

    step_id: str
    recipe_id: str
    catalog_version: str
    path_kind: InteractionPathKind
    title: str
    operator_id: str | None
    revealed_depth: int
    reason: str | None
    items: tuple[MenuGuidanceItem, ...]

    @property
    def native(self) -> bool:
        """Whether the path is wired to a verified real host control."""

        return self.path_kind is InteractionPathKind.NATIVE

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

        return self.native and operator_id == self.operator_id


def _recipe_for_step(
    step: TaskNode,
    catalog: InteractionCatalog,
) -> InteractionRecipe | None:
    action = step.action
    if action is None or action.adapter_id != catalog.adapter_id:
        return None
    return catalog.recipe_for(action.name)


class MenuGuidanceTracker:
    """Keep transient menu reveal depth separate from executable plan state."""

    def __init__(
        self,
        catalog: InteractionCatalog = BUNDLED_INTERACTION_CATALOG,
    ) -> None:
        self._catalog = catalog
        self._step_key: tuple[str, str] | None = None
        self._revealed_depth = 1

    def reset(self) -> None:
        self._step_key = None
        self._revealed_depth = 1

    def snapshot(self, step: TaskNode | None) -> MenuGuidanceSnapshot | None:
        if step is None:
            self.reset()
            return None
        recipe = _recipe_for_step(step, self._catalog)
        if recipe is None:
            self.reset()
            return None
        step_key = (step.id, recipe.id)
        if self._step_key != step_key:
            self._step_key = step_key
            self._revealed_depth = 1
        guidance = recipe.guidance
        items: list[MenuGuidanceItem] = []
        current_index = self._revealed_depth - 1
        for index, definition in enumerate(guidance.steps):
            if guidance.kind is InteractionPathKind.SEMANTIC:
                role = MenuGuidanceRole.LOCKED
            elif index < current_index - 1:
                role = MenuGuidanceRole.COMPLETED
            elif index == current_index - 1:
                role = MenuGuidanceRole.PREVIOUS
            elif index == current_index:
                role = MenuGuidanceRole.CURRENT
            elif index == current_index + 1:
                role = MenuGuidanceRole.NEXT
            else:
                role = MenuGuidanceRole.LOCKED
            items.append(
                MenuGuidanceItem(
                    ordinal=definition.order,
                    step_id=definition.id,
                    label=definition.label,
                    intent=definition.intent,
                    target_kind=definition.target_kind,
                    target_id=definition.target_id,
                    role=role,
                )
            )
        return MenuGuidanceSnapshot(
            step_id=step.id,
            recipe_id=recipe.id,
            catalog_version=self._catalog.catalog_version,
            path_kind=guidance.kind,
            title=recipe.title,
            operator_id=guidance.operator_id,
            revealed_depth=(
                self._revealed_depth
                if guidance.kind is InteractionPathKind.NATIVE
                else 0
            ),
            reason=guidance.reason,
            items=tuple(items),
        )

    def reveal(self, step: TaskNode, label: str) -> bool:
        recipe = _recipe_for_step(step, self._catalog)
        if recipe is None or recipe.guidance.kind is not InteractionPathKind.NATIVE:
            return False
        if self._step_key is None:
            self.snapshot(step)
        if self._step_key != (step.id, recipe.id):
            return False
        labels = tuple(item.label for item in recipe.guidance.steps)
        try:
            label_index = labels.index(label)
        except ValueError:
            return False
        if label_index <= 0 or label_index >= len(labels) - 1:
            return False
        self._revealed_depth = max(self._revealed_depth, label_index + 1)
        return True


__all__ = (
    "MenuGuidanceItem",
    "MenuGuidanceRole",
    "MenuGuidanceSnapshot",
    "MenuGuidanceTracker",
)
