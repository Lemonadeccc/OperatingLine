"""Deterministic presentation state derived from a guide session."""

from dataclasses import dataclass
from enum import Enum
from typing import Protocol

from ..domain import TaskNode


class GuidanceSession(Protocol):
    """Small session surface needed to derive guidance state."""

    steps: tuple[TaskNode, ...]
    active_index: int
    observation_blocked: bool


class GuidanceState(str, Enum):
    """Stable visual state for an executable step or task-tree group."""

    COMPLETED = "completed"
    BACK = "back"
    NEXT = "next"
    LOCKED = "locked"


@dataclass(frozen=True, slots=True)
class GuidanceStep:
    """An executable step paired with its stable presentation state."""

    step: TaskNode
    index: int
    state: GuidanceState


def _active_index(session: GuidanceSession) -> int:
    active_index = session.active_index
    if active_index < -1 or active_index >= len(session.steps):
        raise ValueError("Session active_index is outside its executable steps")
    return active_index


def _step_index(session: GuidanceSession, step_or_index: TaskNode | int) -> int:
    if isinstance(step_or_index, int):
        index = step_or_index
    else:
        index = next(
            (
                candidate_index
                for candidate_index, candidate in enumerate(session.steps)
                if candidate.id == step_or_index.id
            ),
            -1,
        )
    if index < 0 or index >= len(session.steps):
        raise ValueError("Step is not part of the session executable steps")
    return index


def step_state(
    session: GuidanceSession, step_or_index: TaskNode | int
) -> GuidanceState:
    """Return the stable state for one executable step.

    The current ``active_index`` is the step that Back would roll back. The
    following index is the step that Next would execute.
    """

    active_index = _active_index(session)
    index = _step_index(session, step_or_index)
    if index < active_index:
        return GuidanceState.COMPLETED
    if index == active_index:
        return GuidanceState.BACK
    if index == active_index + 1:
        if getattr(session, "observation_blocked", False):
            return GuidanceState.LOCKED
        return GuidanceState.NEXT
    return GuidanceState.LOCKED


def node_state(session: GuidanceSession, node: TaskNode) -> GuidanceState:
    """Aggregate executable descendant states for a task-tree node."""

    if node.action is not None:
        return step_state(session, node)

    descendant_states: list[GuidanceState] = []

    def collect(descendant: TaskNode) -> None:
        if descendant.action is not None:
            descendant_states.append(step_state(session, descendant))
            return
        for child in descendant.children:
            collect(child)

    collect(node)
    if GuidanceState.BACK in descendant_states:
        return GuidanceState.BACK
    if GuidanceState.NEXT in descendant_states:
        return GuidanceState.NEXT
    if descendant_states and all(
        state is GuidanceState.COMPLETED for state in descendant_states
    ):
        return GuidanceState.COMPLETED
    return GuidanceState.LOCKED


def relevant_steps(
    session: GuidanceSession, limit: int = 4
) -> tuple[GuidanceStep, ...]:
    """Return the latest completed, Back, and Next steps in execution order."""

    if limit <= 0:
        raise ValueError("Guidance step limit must be positive")
    active_index = _active_index(session)
    last_relevant_index = min(active_index + 1, len(session.steps) - 1)
    if last_relevant_index < 0:
        return ()
    first_relevant_index = max(0, last_relevant_index - limit + 1)
    return tuple(
        GuidanceStep(
            step=session.steps[index],
            index=index,
            state=step_state(session, index),
        )
        for index in range(first_relevant_index, last_relevant_index + 1)
    )
