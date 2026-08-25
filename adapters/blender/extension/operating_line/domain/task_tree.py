"""Validated task-tree construction from bundled plan resources."""

from dataclasses import dataclass
from copy import deepcopy
import json
import math
from pathlib import Path
import re
from typing import Any

RESOURCE_PATH = Path(__file__).parents[1] / "resources" / "snowman.plan.json"
ACTION_CATALOG_PATH = Path(__file__).parents[1] / "resources" / "action-catalog.json"
STEP_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]*")
CATALOG_VERSION_PATTERN = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)")
CONTENT_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True, slots=True)
class ActionSpec:
    adapter_id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ObservationPolicySpec:
    mode: str
    failure_strategy: str | None = None
    retry_mode: str | None = None
    max_attempts: int = 1


@dataclass(frozen=True, slots=True)
class ExecutionTrackOverrideSpec:
    kind: str
    interaction_catalog_version: str
    interaction_catalog_content_sha256: str
    recipe_id: str
    modality: str
    track_id: str
    track_content_sha256: str
    proof_execution_content_sha256: str


@dataclass(frozen=True, slots=True)
class CandidateMenuProjectionSpec:
    projection: str
    interaction_catalog_version: str
    id: str
    modality: str
    equivalence: str
    execution_authority: str
    title: str
    reason: str
    preconditions: tuple[dict[str, Any], ...]
    operations: tuple[dict[str, Any], ...]
    omitted_action_arguments: tuple[dict[str, str], ...]
    native_evidence: dict[str, Any] | None = None


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
    observation_policy: ObservationPolicySpec | None = None
    execution_track_override: ExecutionTrackOverrideSpec | None = None
    candidate_menu_projection: CandidateMenuProjectionSpec | None = None
    children: tuple["TaskNode", ...] = ()


def _is_json_value(value: Any) -> bool:
    if value is None or isinstance(value, (str, bool, int)):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, list):
        return all(_is_json_value(item) for item in value)
    if isinstance(value, dict):
        return all(
            isinstance(key, str) and bool(key) and _is_json_value(item)
            for key, item in value.items()
        )
    return False


def validate_candidate_menu_projection_data(
    value: Any,
) -> CandidateMenuProjectionSpec:
    """Strictly parse display-only Guide 1.7 native-menu candidate metadata."""

    required_fields = {
        "projection",
        "interactionCatalogVersion",
        "id",
        "modality",
        "equivalence",
        "executionAuthority",
        "title",
        "reason",
        "preconditions",
        "operations",
        "omittedActionArguments",
    }
    if (
        not isinstance(value, dict)
        or not required_fields.issubset(value)
        or set(value) - (required_fields | {"nativeEvidence"})
    ):
        raise ValueError("Invalid candidateMenuProjection")
    if (
        value.get("projection") != "candidate_only"
        or value.get("modality") != "menu"
        or value.get("equivalence") != "not_equivalent_to_managed_action"
        or value.get("executionAuthority") != "none"
    ):
        raise ValueError("Invalid candidateMenuProjection authority")
    catalog_version = value.get("interactionCatalogVersion")
    projection_id = value.get("id")
    if (
        not isinstance(catalog_version, str)
        or CATALOG_VERSION_PATTERN.fullmatch(catalog_version) is None
        or not isinstance(projection_id, str)
        or STEP_ID_PATTERN.fullmatch(projection_id) is None
    ):
        raise ValueError("Invalid candidateMenuProjection identity")
    for field in ("title", "reason"):
        if not isinstance(value.get(field), str) or not value[field]:
            raise ValueError("Invalid candidateMenuProjection text")

    preconditions = value.get("preconditions")
    precondition_kinds = {
        "workspace",
        "editor",
        "mode",
        "selection",
        "keymap",
        "modal_state",
        "scene_state",
    }
    if not isinstance(preconditions, list) or not preconditions:
        raise ValueError("Invalid candidateMenuProjection preconditions")
    for precondition in preconditions:
        if (
            not isinstance(precondition, dict)
            or set(precondition) != {"kind", "label", "value"}
            or precondition.get("kind") not in precondition_kinds
            or any(
                not isinstance(precondition.get(field), str)
                or not precondition[field]
                for field in ("label", "value")
            )
        ):
            raise ValueError("Invalid candidateMenuProjection preconditions")

    operations = value.get("operations")
    operation_fields = {
        "id",
        "order",
        "semanticRefs",
        "description",
        "evidenceRefs",
        "intent",
        "target",
        "path",
        "parameters",
    }
    target_kinds = {
        "workspace",
        "editor",
        "mode",
        "menu",
        "menu_item",
        "operator",
        "control",
        "panel",
        "node",
        "socket",
        "canvas",
        "semantic",
    }
    operation_ids: list[str] = []
    if not isinstance(operations, list) or not operations:
        raise ValueError("Invalid candidateMenuProjection operations")
    for index, operation in enumerate(operations, start=1):
        if not isinstance(operation, dict) or set(operation) != operation_fields:
            raise ValueError("Invalid candidateMenuProjection operation")
        operation_id = operation.get("id")
        if (
            not isinstance(operation_id, str)
            or STEP_ID_PATTERN.fullmatch(operation_id) is None
            or operation_id in operation_ids
            or isinstance(operation.get("order"), bool)
            or operation.get("order") != index
            or not isinstance(operation.get("description"), str)
            or not operation["description"]
            or operation.get("intent")
            not in {"navigate", "configure", "execute", "verify"}
        ):
            raise ValueError("Invalid candidateMenuProjection operation")
        operation_ids.append(operation_id)
        for refs_field, minimum in (("semanticRefs", 1), ("evidenceRefs", 0)):
            refs = operation.get(refs_field)
            if (
                not isinstance(refs, list)
                or len(refs) < minimum
                or any(
                    not isinstance(reference, str)
                    or STEP_ID_PATTERN.fullmatch(reference) is None
                    for reference in refs
                )
            ):
                raise ValueError("Invalid candidateMenuProjection operation references")
        target = operation.get("target")
        if (
            not isinstance(target, dict)
            or not {"kind", "hostId"}.issubset(target)
            or set(target) - {"kind", "hostId", "connection"}
            or target.get("kind") not in target_kinds
            or not isinstance(target.get("hostId"), str)
            or not target["hostId"]
        ):
            raise ValueError("Invalid candidateMenuProjection operation target")
        connection = target.get("connection")
        if "connection" in target:
            connection_fields = {"fromNode", "fromSocket", "toNode", "toSocket"}
            if (
                target["kind"] != "semantic"
                or not isinstance(connection, dict)
                or set(connection) != connection_fields
                or any(
                    not isinstance(connection.get(field), str) or not connection[field]
                    for field in connection_fields
                )
            ):
                raise ValueError("Invalid candidateMenuProjection node connection")
        path = operation.get("path")
        if (
            not isinstance(path, list)
            or not path
            or any(not isinstance(segment, str) or not segment for segment in path)
        ):
            raise ValueError("Invalid candidateMenuProjection operation path")
        parameters = operation.get("parameters")
        if not isinstance(parameters, dict) or not _is_json_value(parameters):
            raise ValueError("Invalid candidateMenuProjection operation parameters")

    omissions = value.get("omittedActionArguments")
    if not isinstance(omissions, list):
        raise ValueError("Invalid candidateMenuProjection omissions")
    for omission in omissions:
        if (
            not isinstance(omission, dict)
            or set(omission) != {"argumentName", "reason"}
            or any(
                not isinstance(omission.get(field), str) or not omission[field]
                for field in ("argumentName", "reason")
            )
        ):
            raise ValueError("Invalid candidateMenuProjection omissions")

    native_evidence = value.get("nativeEvidence")
    if "nativeEvidence" in value:
        evidence_fields = {
            "kind",
            "executorId",
            "hostVersions",
            "managedActionExecuted",
            "managedReceiptCreated",
            "managedReplacementMeshCreated",
            "nativeMutationKind",
            "operationIds",
            "nativeUndoCheckpointRequired",
            "nativeUndoDepth",
            "nativeRedoDepth",
        }
        if not isinstance(native_evidence, dict) or set(native_evidence) != evidence_fields:
            raise ValueError("Invalid candidateMenuProjection native evidence")
        host_versions = native_evidence.get("hostVersions")
        if (
            native_evidence.get("kind") != "bounded_blender_ui_probe"
            or not isinstance(native_evidence.get("executorId"), str)
            or not native_evidence["executorId"]
            or not isinstance(native_evidence.get("nativeMutationKind"), str)
            or not native_evidence["nativeMutationKind"]
            or not isinstance(host_versions, list)
            or not host_versions
            or any(not isinstance(version, str) or not version for version in host_versions)
            or len(set(host_versions)) != len(host_versions)
            or native_evidence.get("managedActionExecuted") is not False
            or native_evidence.get("managedReceiptCreated") is not False
            or native_evidence.get("managedReplacementMeshCreated") is not False
            or native_evidence.get("nativeUndoCheckpointRequired") is not True
            or native_evidence.get("operationIds") != operation_ids
            or any(
                isinstance(native_evidence.get(field), bool)
                or not isinstance(native_evidence.get(field), int)
                or native_evidence[field] <= 0
                for field in ("nativeUndoDepth", "nativeRedoDepth")
            )
        ):
            raise ValueError("Invalid candidateMenuProjection native evidence")

    return CandidateMenuProjectionSpec(
        projection="candidate_only",
        interaction_catalog_version=catalog_version,
        id=projection_id,
        modality="menu",
        equivalence="not_equivalent_to_managed_action",
        execution_authority="none",
        title=value["title"],
        reason=value["reason"],
        preconditions=tuple(deepcopy(preconditions)),
        operations=tuple(deepcopy(operations)),
        omitted_action_arguments=tuple(deepcopy(omissions)),
        native_evidence=deepcopy(native_evidence),
    )


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
    protocol_version = plan.get("protocolVersion")
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
        observation_policy_present = "observationPolicy" in raw
        observation_policy_raw = raw.get("observationPolicy")
        observation_policy = None
        if observation_policy_present:
            if protocol_version not in {
                "1.2.0",
                "1.3.0",
                "1.4.0",
                "1.5.0",
                "1.6.0",
                "1.7.0",
            }:
                raise ValueError("Observation policies require guide protocol 1.2+")
            if action is None:
                raise ValueError(
                    f"Only executable steps can declare an observation policy: {step_id}"
                )
            if not isinstance(observation_policy_raw, dict):
                raise ValueError(f"Invalid observationPolicy on step: {step_id}")
            mode = observation_policy_raw.get("mode")
            if mode == "telemetry" and set(observation_policy_raw) == {"mode"}:
                observation_policy = ObservationPolicySpec(mode="telemetry")
            elif mode == "success_gate" and set(observation_policy_raw) in (
                {"mode", "failureStrategy"},
                {"mode", "failureStrategy", "retryPolicy"},
            ):
                failure_strategy = observation_policy_raw.get("failureStrategy")
                if failure_strategy not in {"rollback_step", "retain_for_repair"}:
                    raise ValueError(f"Invalid observationPolicy on step: {step_id}")
                retry_mode = None
                max_attempts = 1
                if "retryPolicy" in observation_policy_raw:
                    retry_policy = observation_policy_raw.get("retryPolicy")
                    if (
                        protocol_version not in {"1.5.0", "1.6.0", "1.7.0"}
                        or failure_strategy != "rollback_step"
                        or not isinstance(retry_policy, dict)
                        or set(retry_policy) != {"mode", "maxAttempts"}
                        or retry_policy.get("mode") != "automatic_bounded"
                        or isinstance(retry_policy.get("maxAttempts"), bool)
                        or retry_policy.get("maxAttempts") not in {2, 3}
                    ):
                        raise ValueError(f"Invalid observationPolicy on step: {step_id}")
                    retry_mode = "automatic_bounded"
                    max_attempts = retry_policy["maxAttempts"]
                if not expected_observations:
                    raise ValueError(
                        f"Success-gated step requires observations: {step_id}"
                    )
                observation_policy = ObservationPolicySpec(
                    mode="success_gate",
                    failure_strategy=failure_strategy,
                    retry_mode=retry_mode,
                    max_attempts=max_attempts,
                )
            else:
                raise ValueError(f"Invalid observationPolicy on step: {step_id}")
        execution_track_override = None
        if "executionTrackOverride" in raw:
            override_raw = raw.get("executionTrackOverride")
            expected_override_fields = {
                "kind",
                "interactionCatalogVersion",
                "interactionCatalogContentSha256",
                "recipeId",
                "modality",
                "trackId",
                "trackContentSha256",
                "proofExecutionContentSha256",
            }
            if protocol_version not in {"1.6.0", "1.7.0"}:
                raise ValueError("Execution track overrides require guide protocol 1.6")
            if action is None:
                raise ValueError(
                    f"Only executable steps can declare an execution track override: {step_id}"
                )
            if (
                not isinstance(override_raw, dict)
                or set(override_raw) != expected_override_fields
            ):
                raise ValueError(f"Invalid executionTrackOverride on step: {step_id}")
            if override_raw.get("kind") != "interaction_catalog_proof":
                raise ValueError(f"Invalid executionTrackOverride on step: {step_id}")
            catalog_version = override_raw.get("interactionCatalogVersion")
            if (
                not isinstance(catalog_version, str)
                or CATALOG_VERSION_PATTERN.fullmatch(catalog_version) is None
            ):
                raise ValueError(f"Invalid executionTrackOverride on step: {step_id}")
            for identifier_field in ("recipeId", "trackId"):
                identifier = override_raw.get(identifier_field)
                if (
                    not isinstance(identifier, str)
                    or STEP_ID_PATTERN.fullmatch(identifier) is None
                ):
                    raise ValueError(f"Invalid executionTrackOverride on step: {step_id}")
            if override_raw.get("modality") not in {"menu", "shortcut"}:
                raise ValueError(f"Invalid executionTrackOverride on step: {step_id}")
            for hash_field in (
                "interactionCatalogContentSha256",
                "trackContentSha256",
                "proofExecutionContentSha256",
            ):
                digest = override_raw.get(hash_field)
                if (
                    not isinstance(digest, str)
                    or CONTENT_SHA256_PATTERN.fullmatch(digest) is None
                ):
                    raise ValueError(f"Invalid executionTrackOverride on step: {step_id}")
            execution_track_override = ExecutionTrackOverrideSpec(
                kind="interaction_catalog_proof",
                interaction_catalog_version=catalog_version,
                interaction_catalog_content_sha256=override_raw[
                    "interactionCatalogContentSha256"
                ],
                recipe_id=override_raw["recipeId"],
                modality=override_raw["modality"],
                track_id=override_raw["trackId"],
                track_content_sha256=override_raw["trackContentSha256"],
                proof_execution_content_sha256=override_raw[
                    "proofExecutionContentSha256"
                ],
            )
        candidate_menu_projection = None
        if "candidateMenuProjection" in raw:
            if protocol_version != "1.7.0":
                raise ValueError("Candidate menu projections require guide protocol 1.7")
            if action is None:
                raise ValueError(
                    f"Only executable steps can carry a candidate menu projection: {step_id}"
                )
            if children:
                raise ValueError(
                    f"Only leaf steps can carry a candidate menu projection: {step_id}"
                )
            candidate_menu_projection = validate_candidate_menu_projection_data(
                raw.get("candidateMenuProjection")
            )
        return TaskNode(
            id=step_id,
            number=number,
            title=title,
            order=raw["order"],
            depends_on=tuple(raw["dependsOn"]),
            action=action,
            anchors=tuple(dict(item) for item in anchors),
            expected_observations=tuple(dict(item) for item in expected_observations),
            observation_policy=observation_policy,
            execution_track_override=execution_track_override,
            candidate_menu_projection=candidate_menu_projection,
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

with ACTION_CATALOG_PATH.open(encoding="utf-8") as _catalog_resource:
    _BUNDLED_ACTION_CATALOG = json.load(_catalog_resource)
BLENDER_ACTION_CATALOG_VERSION = _BUNDLED_ACTION_CATALOG.get("catalogVersion")
if (
    not isinstance(BLENDER_ACTION_CATALOG_VERSION, str)
    or CATALOG_VERSION_PATTERN.fullmatch(BLENDER_ACTION_CATALOG_VERSION) is None
):
    raise ValueError("Bundled action catalog version must use stable x.y.z form")


def bundled_plan_data() -> dict[str, Any]:
    """Return an isolated copy of the offline plan for immutable revision requests."""
    return deepcopy(_BUNDLED_PLAN)


def bundled_action_catalog_data() -> dict[str, Any]:
    """Return an isolated copy of the bundled parameter and action contract."""
    return deepcopy(_BUNDLED_ACTION_CATALOG)


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
            key=lambda node: (
                tuple(int(component) for component in node.number.split(".")),
                node.id,
            ),
        )
        if not ready:
            raise ValueError("No executable action step remains")
        next_step = ready[0]
        ordered.append(next_step)
        completed.add(next_step.id)
        del remaining[next_step.id]

    return tuple(ordered)
