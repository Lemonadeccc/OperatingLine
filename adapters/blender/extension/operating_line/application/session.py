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
    session_uid: int
    receipt_token: str
    step_id: str = ""
    action_name: str = ""
    parent_links: tuple[ParentIdentity, ...] = ()


@dataclass(frozen=True, slots=True)
class DataBlockReference:
    """Stable reference to a Blender ID that is not owned by the action."""

    resource_type: str
    display_name: str
    pointer: int
    session_uid: int


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
    media_type: str = "application/octet-stream"
    frame: int | None = None
    render_engine: str | None = None
    color_management: str | None = None


@dataclass(frozen=True, slots=True)
class ModifierState:
    """Tracked state of one action-owned non-ID Blender modifier."""

    logical_id: str
    display_name: str
    modifier_type: str
    pointer: int
    stack_index: int
    receipt_token: str
    step_id: str
    action_name: str
    properties: tuple[tuple[str, Any], ...] = ()


@dataclass(frozen=True, slots=True)
class VertexGroupState:
    """Exact state of one action-created Blender vertex group."""

    display_name: str
    stack_index: int
    lock_weight: bool
    assignments: tuple[tuple[int, float], ...]


@dataclass(frozen=True, slots=True)
class SkinWeightsState:
    """Bounded vertex-group state created by one deform-binding action."""

    logical_id: str
    receipt_token: str
    step_id: str
    action_name: str
    vertex_count: int
    groups: tuple[VertexGroupState, ...]


@dataclass(frozen=True, slots=True)
class PoseBoneState:
    """Restorable local pose transform for one animated bone."""

    rotation_mode: str
    location: tuple[float, float, float]
    rotation_euler: tuple[float, float, float]
    scale: tuple[float, float, float]


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
EvaluateObservations = Callable[
    [tuple[dict[str, Any], ...], Mapping[str, ActionReceipt]],
    list[dict[str, Any]],
]


@dataclass(frozen=True, slots=True)
class ObservationGateState:
    """One deterministic success-gate outcome for companion reporting and recovery."""

    step_id: str
    status: str
    failure_strategy: str
    message: str
    observations: tuple[dict[str, Any], ...]

    @property
    def blocking(self) -> bool:
        return self.status in {"repair_required", "rollback_failed"}

    def report_data(self) -> dict[str, str]:
        return {
            "stepId": self.step_id,
            "status": self.status,
            "failureStrategy": self.failure_strategy,
            "message": self.message,
        }

    def observation_copy(self) -> list[dict[str, Any]]:
        return deepcopy(list(self.observations))


class ObservationGateError(RuntimeError):
    """Expected, recoverable failure of a step's declared success gate."""

    def __init__(self, step: TaskNode, gate: ObservationGateState) -> None:
        super().__init__(gate.message)
        self.step = step
        self.gate = gate


@dataclass(frozen=True, slots=True)
class SessionSnapshot:
    """Immutable Python state paired with one Blender native-history checkpoint."""

    plan_id: str | None
    revision: int | None
    active_index: int
    started: bool
    execution_id: str | None
    receipts: tuple[tuple[str, ActionReceipt], ...]
    observation_gate: ObservationGateState | None
    last_success_gate_result: tuple[str, tuple[dict[str, Any], ...]] | None


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
        observation_evaluator: EvaluateObservations | None = None,
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
        if observation_evaluator is None and any(
            step.observation_policy is not None
            and step.observation_policy.mode == "success_gate"
            for step in self.steps
        ):
            raise ValueError("A success-gated plan requires an observation evaluator")
        self._observation_evaluator = observation_evaluator
        self.active_index = -1
        self.started = False
        self.receipts: dict[str, ActionReceipt] = {}
        self.observation_gate: ObservationGateState | None = None
        self._last_success_gate_result: (
            tuple[str, tuple[dict[str, Any], ...]] | None
        ) = None
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

    @property
    def observation_blocked(self) -> bool:
        return self.observation_gate is not None and self.observation_gate.blocking

    @property
    def completed_steps(self) -> tuple[TaskNode, ...]:
        completed = self.steps[: self.active_index + 1]
        gate = self.observation_gate
        if gate is not None and gate.blocking:
            return tuple(step for step in completed if step.id != gate.step_id)
        return completed

    @property
    def completed_step_ids(self) -> tuple[str, ...]:
        return tuple(step.id for step in self.completed_steps)

    def success_gate_observation_copy(
        self,
        step_id: str,
    ) -> list[dict[str, Any]] | None:
        result = self._last_success_gate_result
        if result is None or result[0] != step_id:
            return None
        return deepcopy(list(result[1]))

    def snapshot_state(self) -> SessionSnapshot:
        """Capture module state without copying Blender RNA values in receipts."""
        return SessionSnapshot(
            plan_id=self.plan_id,
            revision=self.revision,
            active_index=self.active_index,
            started=self.started,
            execution_id=self.execution_id,
            receipts=tuple(self.receipts.items()),
            observation_gate=deepcopy(self.observation_gate),
            last_success_gate_result=deepcopy(self._last_success_gate_result),
        )

    def restore_state(
        self,
        snapshot: SessionSnapshot,
        *,
        receipts: Mapping[str, ActionReceipt] | None = None,
    ) -> None:
        """Restore a checkpoint after Blender has restored its matching ID state."""
        if snapshot.plan_id != self.plan_id or snapshot.revision != self.revision:
            raise ValueError("Native history checkpoint belongs to a different plan")
        if not -1 <= snapshot.active_index < len(self.steps):
            raise ValueError("Native history checkpoint has an invalid active step")
        restored_receipts = dict(snapshot.receipts) if receipts is None else dict(receipts)
        known_step_ids = {step.id for step in self.steps}
        if not set(restored_receipts).issubset(known_step_ids):
            raise ValueError("Native history checkpoint contains unknown receipt steps")
        self.active_index = snapshot.active_index
        self.started = snapshot.started
        self.execution_id = snapshot.execution_id
        self.receipts = restored_receipts
        self.observation_gate = deepcopy(snapshot.observation_gate)
        self._last_success_gate_result = deepcopy(snapshot.last_success_gate_result)

    def abandon_state(self) -> None:
        """Forget Python receipts when Blender replaces the entire loaded file."""
        self.receipts.clear()
        self.active_index = -1
        self.started = False
        self.execution_id = None
        self.observation_gate = None
        self._last_success_gate_result = None

    def start(self) -> None:
        self.reset()
        self.execution_id = str(uuid.uuid4())
        self.started = True

    def _step_actions(self, step: TaskNode) -> tuple[ExecuteAction, RollbackAction]:
        return self._actions[step.id]

    @staticmethod
    def _failed_observations(
        step: TaskNode,
        evaluation_error: str,
    ) -> list[dict[str, Any]]:
        return [
            {
                "kind": str(expectation.get("kind")),
                "satisfied": False,
                "details": {
                    "parameters": deepcopy(expectation.get("parameters", {})),
                    "supported": True,
                    "evaluationError": evaluation_error,
                },
            }
            for expectation in step.expected_observations
        ]

    def _evaluate_step(self, step: TaskNode) -> list[dict[str, Any]]:
        evaluator = self._observation_evaluator
        if evaluator is None:
            return self._failed_observations(step, "EvaluatorUnavailable")
        try:
            observations = evaluator(step.expected_observations, self.receipts)
        except Exception as error:
            return self._failed_observations(step, type(error).__name__)
        if not isinstance(observations, list) or len(observations) != len(
            step.expected_observations
        ):
            return self._failed_observations(step, "InvalidObservationResult")
        for expectation, observation in zip(
            step.expected_observations,
            observations,
            strict=True,
        ):
            if (
                not isinstance(observation, dict)
                or set(observation) != {"kind", "satisfied", "details"}
                or observation.get("kind") != str(expectation.get("kind"))
                or not isinstance(observation.get("satisfied"), bool)
                or not isinstance(observation.get("details"), dict)
            ):
                return self._failed_observations(step, "InvalidObservationResult")
        return deepcopy(observations)

    @staticmethod
    def _gate_message(step: TaskNode, observations: list[dict[str, Any]]) -> str:
        failed_kinds = [
            str(observation["kind"])
            for observation in observations
            if not observation["satisfied"]
        ]
        return (
            f"Observation gate failed for {step.id}: "
            + ", ".join(failed_kinds)
        )

    @staticmethod
    def _gate_state(
        step: TaskNode,
        *,
        status: str,
        message: str,
        observations: list[dict[str, Any]],
    ) -> ObservationGateState:
        policy = step.observation_policy
        if policy is None or policy.failure_strategy is None:
            raise RuntimeError(f"Step {step.id} does not declare a success gate")
        return ObservationGateState(
            step_id=step.id,
            status=status,
            failure_strategy=policy.failure_strategy,
            message=message,
            observations=tuple(deepcopy(observations)),
        )

    def next(self) -> TaskNode | None:
        if not self.started:
            self.start()
        if self.observation_blocked:
            gate = self.observation_gate
            step = self.active_step
            if gate is None or step is None:
                raise RuntimeError("Observation gate state is inconsistent")
            raise ObservationGateError(step, gate)
        self.observation_gate = None
        self._last_success_gate_result = None
        next_index = self.active_index + 1
        if next_index >= len(self.steps):
            return None
        step = self.steps[next_index]
        execute, rollback = self._step_actions(step)
        receipt = execute(self.receipts)
        action_name = step.action.name if step.action else ""
        if receipt.step_id != step.id or receipt.action_name != action_name:
            raise RuntimeError(f"Action returned a receipt for the wrong step: {step.id}")
        self.receipts[step.id] = receipt
        policy = step.observation_policy
        if policy is not None and policy.mode == "success_gate":
            observations = self._evaluate_step(step)
            if not observations or not all(
                observation["satisfied"] for observation in observations
            ):
                message = self._gate_message(step, observations)
                if policy.failure_strategy == "rollback_step":
                    try:
                        rollback(receipt)
                    except Exception as rollback_error:
                        self.active_index = next_index
                        gate = self._gate_state(
                            step,
                            status="rollback_failed",
                            message=(
                                f"{message}; automatic rollback failed "
                                f"({type(rollback_error).__name__})"
                            ),
                            observations=observations,
                        )
                        self.observation_gate = gate
                        raise ObservationGateError(step, gate) from rollback_error
                    del self.receipts[step.id]
                    gate = self._gate_state(
                        step,
                        status="failed_rolled_back",
                        message=f"{message}; the step was rolled back",
                        observations=observations,
                    )
                    self.observation_gate = gate
                    raise ObservationGateError(step, gate)
                self.active_index = next_index
                gate = self._gate_state(
                    step,
                    status="repair_required",
                    message=f"{message}; repair the scene or use Back",
                    observations=observations,
                )
                self.observation_gate = gate
                raise ObservationGateError(step, gate)
            self._last_success_gate_result = (
                step.id,
                tuple(deepcopy(observations)),
            )
        self.active_index = next_index
        return step

    def recheck_observations(self) -> TaskNode:
        gate = self.observation_gate
        step = self.active_step
        if gate is None or not gate.blocking or step is None or gate.step_id != step.id:
            raise ValueError("No blocked observation gate is available to recheck")
        observations = self._evaluate_step(step)
        if observations and all(
            observation["satisfied"] for observation in observations
        ):
            self.observation_gate = self._gate_state(
                step,
                status="recovered",
                message=f"Observation gate recovered for {step.id}",
                observations=observations,
            )
            self._last_success_gate_result = (
                step.id,
                tuple(deepcopy(observations)),
            )
            return step
        self.observation_gate = self._gate_state(
            step,
            status=gate.status,
            message=(
                f"{self._gate_message(step, observations)}; "
                "repair the scene or use Back"
            ),
            observations=observations,
        )
        raise ObservationGateError(step, self.observation_gate)

    def evaluate_current_step_observations(
        self,
        step_id: str,
    ) -> tuple[TaskNode | None, list[dict[str, Any]]]:
        """Evaluate one known step without mutating progress or gate state."""
        step = next((candidate for candidate in self.steps if candidate.id == step_id), None)
        if step is None:
            return None, []
        return step, self._evaluate_step(step)

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
        self.observation_gate = None
        self._last_success_gate_result = None
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
        self.observation_gate = None
        self._last_success_gate_result = None
