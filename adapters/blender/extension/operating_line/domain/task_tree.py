"""Validated task-tree construction from bundled plan resources."""

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Any

RESOURCE_PATH = Path(__file__).parents[1] / "resources" / "snowman.plan.json"
STEP_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]*")


@dataclass(frozen=True, slots=True)
class ActionSpec:
    adapter_id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True, slots=True)
class TaskNode:
    id: str
    number: str
    title: str
    order: int
    depends_on: tuple[str, ...] = ()
    action: ActionSpec | None = None
    anchors: tuple[dict[str, Any], ...] = ()
    expected_observations: tuple[dict[str, Any], ...] = ()
    children: tuple["TaskNode", ...] = ()


def load_task_tree(path: Path = RESOURCE_PATH) -> TaskNode:
    with path.open(encoding="utf-8") as resource:
        plan = json.load(resource)
    return load_task_tree_data(plan)


def load_task_tree_data(plan: dict[str, Any]) -> TaskNode:
    """Validate and build a task tree from an in-memory guide plan."""
    if not isinstance(plan, dict):
        raise ValueError("Plan must be a JSON object")
    raw_steps = plan.get("steps")
    root_id = plan.get("rootStepId")
    if not isinstance(raw_steps, list) or not isinstance(root_id, str):
        raise ValueError("Plan must contain steps and rootStepId")

    by_id: dict[str, dict[str, Any]] = {}
    children_by_parent: dict[str | None, list[dict[str, Any]]] = {}
    for raw in raw_steps:
        if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
            raise ValueError("Every plan step must have a string id")
        step_id = raw["id"]
        if STEP_ID_PATTERN.fullmatch(step_id) is None:
            raise ValueError(f"Invalid portable step id: {step_id}")
        if step_id in by_id:
            raise ValueError(f"Duplicate plan step id: {step_id}")
        parent_id = raw.get("parentId")
        if parent_id is not None and not isinstance(parent_id, str):
            raise ValueError(f"Invalid parentId on step: {step_id}")
        order = raw.get("order")
        if isinstance(order, bool) or not isinstance(order, int) or order < 0:
            raise ValueError(f"Invalid order on step: {step_id}")
        dependencies = raw.get("dependsOn")
        if not isinstance(dependencies, list) or not all(
            isinstance(dependency, str) and dependency for dependency in dependencies
        ):
            raise ValueError(f"Invalid dependsOn on step: {step_id}")
        by_id[step_id] = raw
        children_by_parent.setdefault(parent_id, []).append(raw)
    if root_id not in by_id or by_id[root_id].get("parentId") is not None:
        raise ValueError("rootStepId must reference a root step")

    for step_id, raw in by_id.items():
        parent_id = raw.get("parentId")
        if parent_id is not None and parent_id not in by_id:
            raise ValueError(f"Unknown parent {parent_id} for {step_id}")
        dependencies = raw["dependsOn"]
        for dependency in dependencies:
            if dependency not in by_id:
                raise ValueError(f"Unknown dependency {dependency} for {step_id}")
            if dependency == step_id:
                raise ValueError(f"Task step {step_id} cannot depend on itself")

        action_raw = raw.get("action")
        if children_by_parent.get(step_id) and dependencies:
            raise ValueError(
                f"Non-executable group {step_id} cannot declare execution dependencies"
            )
        if action_raw is not None and children_by_parent.get(step_id):
            raise ValueError(f"Action step {step_id} must be a hierarchy leaf")
        if action_raw is not None:
            for dependency in dependencies:
                if by_id[dependency].get("action") is None:
                    raise ValueError(
                        f"Action step {step_id} depends on non-action step {dependency}"
                    )

    dependency_visiting: set[str] = set()
    dependency_visited: set[str] = set()

    def visit_dependencies(step_id: str) -> None:
        if step_id in dependency_visiting:
            raise ValueError(f"Dependency cycle includes {step_id}")
        if step_id in dependency_visited:
            return
        dependency_visiting.add(step_id)
        for dependency in by_id[step_id]["dependsOn"]:
            visit_dependencies(dependency)
        dependency_visiting.remove(step_id)
        dependency_visited.add(step_id)

    for step_id in by_id:
        visit_dependencies(step_id)

    visited: set[str] = set()

    def build(raw: dict[str, Any], number: str) -> TaskNode:
        step_id = raw["id"]
        if step_id in visited:
            raise ValueError(f"Cycle or duplicate tree placement at: {step_id}")
        visited.add(step_id)
        action_raw = raw.get("action")
        action = None
        if action_raw is not None:
            if not isinstance(action_raw, dict) or not isinstance(action_raw.get("arguments"), dict):
                raise ValueError(f"Invalid action on step: {step_id}")
            if not isinstance(action_raw.get("adapterId"), str) or not isinstance(
                action_raw.get("name"), str
            ):
                raise ValueError(f"Invalid action identity on step: {step_id}")
            action = ActionSpec(
                adapter_id=action_raw["adapterId"],
                name=action_raw["name"],
                arguments=dict(action_raw["arguments"]),
            )
        ordered = sorted(
            children_by_parent.get(step_id, ()),
            key=lambda child: (child["order"], child["id"]),
        )
        children = tuple(
            build(child, f"{number}.{index}")
            for index, child in enumerate(ordered, start=1)
        )
        title = raw.get("title")
        if not isinstance(title, str):
            raise ValueError(f"Invalid title on step: {step_id}")
        anchors = raw.get("anchors", [])
        if not isinstance(anchors, list) or not all(
            isinstance(anchor, dict) and isinstance(anchor.get("kind"), str)
            for anchor in anchors
        ):
            raise ValueError(f"Invalid anchors on step: {step_id}")
        expected_observations = raw.get("expectedObservations", [])
        if not isinstance(expected_observations, list) or not all(
            isinstance(observation, dict)
            and isinstance(observation.get("kind"), str)
            and isinstance(observation.get("parameters"), dict)
            for observation in expected_observations
        ):
            raise ValueError(f"Invalid expectedObservations on step: {step_id}")
        return TaskNode(
            id=step_id,
            number=number,
            title=title,
            order=raw["order"],
            depends_on=tuple(raw["dependsOn"]),
            action=action,
            anchors=tuple(dict(item) for item in anchors),
            expected_observations=tuple(dict(item) for item in expected_observations),
            children=children,
        )

    root = build(by_id[root_id], "1")
    if visited != set(by_id):
        raise ValueError("Plan contains steps disconnected from rootStepId")
    return root

with RESOURCE_PATH.open(encoding="utf-8") as _bundled_resource:
    _BUNDLED_PLAN = json.load(_bundled_resource)
SNOWMAN_PLAN_ID = _BUNDLED_PLAN.get("id")
SNOWMAN_PLAN_REVISION = _BUNDLED_PLAN.get("revision")
if not isinstance(SNOWMAN_PLAN_ID, str) or not SNOWMAN_PLAN_ID:
    raise ValueError("Bundled plan id must be a non-empty string")
if (
    isinstance(SNOWMAN_PLAN_REVISION, bool)
    or not isinstance(SNOWMAN_PLAN_REVISION, int)
    or SNOWMAN_PLAN_REVISION <= 0
):
    raise ValueError("Bundled plan revision must be a positive integer")
SNOWMAN_TASK_TREE = load_task_tree_data(_BUNDLED_PLAN)


def executable_steps(root: TaskNode = SNOWMAN_TASK_TREE) -> tuple[TaskNode, ...]:
    """Return action steps in stable dependency-topological order."""
    nodes: dict[str, TaskNode] = {}

    def visit(node: TaskNode) -> None:
        nodes[node.id] = node
        for child in node.children:
            visit(child)

    visit(root)
    remaining = {
        node.id: node for node in nodes.values() if node.action is not None
    }
    completed: set[str] = set()
    ordered: list[TaskNode] = []

    while remaining:
        ready = sorted(
            (
                node
                for node in remaining.values()
                if all(dependency in completed for dependency in node.depends_on)
            ),
            key=lambda node: (node.order, node.id),
        )
        if not ready:
            raise ValueError("No executable action step remains")
        next_step = ready[0]
        ordered.append(next_step)
        completed.add(next_step.id)
        del remaining[next_step.id]

    return tuple(ordered)
