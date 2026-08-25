"""Use-case state and traversal for a validated guide plan."""

from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass, fields, is_dataclass, replace
import hashlib
import math
import re
import struct
from typing import Any
import uuid

from ..domain import TaskNode, executable_steps
from ..domain.guided_geometry_leaf_profiles import (
    GUIDED_LEAF_OPERATION_OBSERVATION_PROFILES,
)


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
class MaterialSurfaceState:
    """Exact bounded Principled surface state for one owned material."""

    display_name: str
    use_nodes: bool
    diffuse_color: tuple[float, float, float, float]
    roughness: float
    metallic: float
    principled_base_color: tuple[float, float, float, float]
    principled_roughness: float
    principled_metallic: float
    node_tree_signature: tuple[Any, ...]


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
    rotation_quaternion: tuple[float, float, float, float]
    rotation_axis_angle: tuple[float, float, float, float]
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
    retry: dict[str, Any] | None = None

    @property
    def blocking(self) -> bool:
        return self.status in {"repair_required", "rollback_failed"}

    def report_data(self) -> dict[str, Any]:
        report = {
            "stepId": self.step_id,
            "status": self.status,
            "failureStrategy": self.failure_strategy,
            "message": self.message,
        }
        if self.retry is not None:
            report["retry"] = deepcopy(self.retry)
        return report

    def observation_copy(self) -> list[dict[str, Any]]:
        return deepcopy(list(self.observations))


class ObservationGateError(RuntimeError):
    """Expected, recoverable failure of a step's declared success gate."""

    def __init__(self, step: TaskNode, gate: ObservationGateState) -> None:
        super().__init__(gate.message)
        self.step = step
        self.gate = gate


@dataclass(frozen=True, slots=True)
class LeafOperationReceipt:
    """Logical evidence for one executed microstep inside a plan leaf."""

    run_id: str
    step_id: str
    action_name: str
    recipe_id: str
    operation_id: str
    ordinal: int
    before_sha256: str
    after_sha256: str
    observation: dict[str, Any]


@dataclass(frozen=True, slots=True)
class LeafOperationRunSnapshot:
    """Undo-restorable execution cursor and partial aggregate leaf receipt."""

    run_id: str
    step_id: str
    action_name: str
    recipe_id: str
    catalog_version: str
    binding_sha256: str
    leaf_receipt_id: str
    operation_ids: tuple[str, ...]
    next_ordinal: int
    operation_receipts: tuple[LeafOperationReceipt, ...]
    partial_action_receipt: ActionReceipt | None
    observation_attempt: int = 1
    status: str = "in_progress"

    @property
    def completed_ordinal(self) -> int:
        return self.next_ordinal - 1


@dataclass(frozen=True, slots=True)
class SessionSnapshot:
    """Immutable Python state paired with one Blender native-history checkpoint."""

    plan_id: str | None
    revision: int | None
    active_index: int
    started: bool
    execution_id: str | None
    receipts: tuple[tuple[str, ActionReceipt], ...]
    leaf_operation_runs: tuple[tuple[str, LeafOperationRunSnapshot], ...]
    observation_gate: ObservationGateState | None
    last_success_gate_result: tuple[str, tuple[dict[str, Any], ...]] | None
    last_success_gate_retry: tuple[str, dict[str, Any]] | None


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
        self.leaf_operation_runs: dict[str, LeafOperationRunSnapshot] = {}
        self.observation_gate: ObservationGateState | None = None
        self._last_success_gate_result: (
            tuple[str, tuple[dict[str, Any], ...]] | None
        ) = None
        self._last_success_gate_retry: tuple[str, dict[str, Any]] | None = None
        self._branch_node_ids = self._branch_ids(root)
        self._nodes_by_id = self._index_nodes(root)
        self._parent_node_ids = self._index_parents(root)
        self.expanded_node_ids: set[str] = set()
        self._ensure_guidance_path_expanded()

    @staticmethod
    def _index_nodes(root: TaskNode) -> dict[str, TaskNode]:
        nodes: dict[str, TaskNode] = {}

        def visit(node: TaskNode) -> None:
            nodes[node.id] = node
            for child in node.children:
                visit(child)

        visit(root)
        return nodes

    @staticmethod
    def _index_parents(root: TaskNode) -> dict[str, str | None]:
        parents: dict[str, str | None] = {root.id: None}

        def visit(node: TaskNode) -> None:
            for child in node.children:
                parents[child.id] = node.id
                visit(child)

        visit(root)
        return parents

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
    def guidance_step(self) -> TaskNode | None:
        """Return the leaf every guidance surface must currently present.

        A blocking observation gate keeps the failed leaf active for repair,
        even though normal traversal would otherwise present the following
        leaf.  Outside that recovery state, guidance continues to point at the
        next executable leaf. A completed plan has no guidance leaf.
        """
        gate = self.observation_gate
        if gate is not None and gate.blocking:
            gated_step = self._nodes_by_id.get(gate.step_id)
            if (
                gated_step is None
                or gated_step.children
                or gated_step not in self.steps
            ):
                raise RuntimeError(
                    "Blocking observation gate does not reference an executable leaf"
                )
            return gated_step
        if not self.steps:
            return None
        next_index = self.active_index + 1
        if next_index < len(self.steps):
            return self.steps[next_index]
        return None

    def _ensure_guidance_path_expanded(self) -> None:
        """Open only the required path without collapsing user-opened branches."""
        self.expanded_node_ids.update(self._guidance_path_branch_ids())

    def _guidance_path_branch_ids(self) -> set[str]:
        """Return branches that must stay open to expose the guidance leaf."""
        required_branch_ids: set[str] = set()
        step = self.guidance_step or self.active_step
        node_id = step.id if step is not None else self.root.id
        while node_id is not None:
            if node_id in self._branch_node_ids:
                required_branch_ids.add(node_id)
            node_id = self._parent_node_ids.get(node_id)
        return required_branch_ids

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

    @property
    def pending_leaf_operation_run(self) -> LeafOperationRunSnapshot | None:
        """Return the sole in-progress leaf-local execution transaction."""

        pending = tuple(
            run
            for run in self.leaf_operation_runs.values()
            if run.status == "in_progress"
        )
        if len(pending) > 1:
            raise RuntimeError("Multiple leaf operation runs are in progress")
        return pending[0] if pending else None

    @property
    def has_pending_leaf_operations(self) -> bool:
        return self.pending_leaf_operation_run is not None

    @property
    def has_execution_state(self) -> bool:
        """Whether plan replacement/revision must be blocked until recovery."""

        return bool(self.receipts) or self.has_pending_leaf_operations

    @property
    def managed_receipts(self) -> dict[str, ActionReceipt]:
        """Return completed receipts plus the current partial leaf receipt."""

        managed = dict(self.receipts)
        pending = self.pending_leaf_operation_run
        if pending is not None and pending.partial_action_receipt is not None:
            if pending.step_id in managed:
                raise RuntimeError("Partial leaf receipt collides with a completed step")
            managed[pending.step_id] = pending.partial_action_receipt
        return managed

    def receipt_for_step(
        self,
        step_id: str,
        *,
        include_partial: bool = True,
    ) -> ActionReceipt | None:
        receipt = self.receipts.get(step_id)
        if receipt is not None or not include_partial:
            return receipt
        run = self.leaf_operation_runs.get(step_id)
        if run is None or run.status != "in_progress":
            return None
        return run.partial_action_receipt

    @staticmethod
    def _leaf_operation_binding_sha256(
        step: TaskNode,
        recipe_id: str,
        catalog_version: str,
        operation_ids: tuple[str, ...],
    ) -> str:
        action = step.action
        if action is None:
            raise ValueError("Leaf operation execution requires an action")
        payload = {
            "stepId": step.id,
            "actionName": action.name,
            "arguments": deepcopy(action.arguments),
            "recipeId": recipe_id,
            "catalogVersion": catalog_version,
            "operationIds": list(operation_ids),
        }
        return hashlib.sha256(_canonical_json_value_bytes(payload, set())).hexdigest()

    def begin_leaf_operation_run(
        self,
        step: TaskNode,
        *,
        recipe_id: str,
        catalog_version: str,
        operation_ids: tuple[str, ...],
    ) -> LeafOperationRunSnapshot:
        """Open a stale-safe, independently undoable microstep transaction."""

        if not self.started:
            raise ValueError("Start the walkthrough before executing leaf operations")
        if self.observation_blocked:
            raise ValueError("Resolve the observation gate before executing leaf operations")
        if step is not self.guidance_step or step.action is None:
            raise ValueError("Leaf operation execution is not bound to the current step")
        if step.execution_track_override is not None:
            raise ValueError("The selected execution track has no leaf operation executor")
        if step.id in self.receipts:
            raise ValueError("The leaf already has a completed action receipt")
        if not recipe_id or not catalog_version:
            raise ValueError("Leaf operation catalog identity is required")
        if (
            not operation_ids
            or len(set(operation_ids)) != len(operation_ids)
            or any(not operation_id for operation_id in operation_ids)
        ):
            raise ValueError("Leaf operation ids must be non-empty and unique")
        existing = self.pending_leaf_operation_run
        if existing is not None:
            if existing.step_id != step.id:
                raise ValueError("Another leaf operation transaction is already in progress")
            self._validate_leaf_operation_run(
                step.id,
                existing,
                self.receipts.get(step.id),
            )
            expected_binding = self._leaf_operation_binding_sha256(
                step,
                recipe_id,
                catalog_version,
                operation_ids,
            )
            if existing.binding_sha256 != expected_binding:
                raise ValueError("The leaf operation binding changed; abort and restart")
            return existing
        observation_attempt = 1
        prior_gate = self.observation_gate
        if (
            prior_gate is not None
            and prior_gate.step_id == step.id
            and prior_gate.status == "retry_scheduled"
            and prior_gate.retry is not None
        ):
            observation_attempt = int(prior_gate.retry["attempt"]) + 1
            self.observation_gate = None
        run = LeafOperationRunSnapshot(
            run_id=str(uuid.uuid4()),
            step_id=step.id,
            action_name=step.action.name,
            recipe_id=recipe_id,
            catalog_version=catalog_version,
            binding_sha256=self._leaf_operation_binding_sha256(
                step,
                recipe_id,
                catalog_version,
                operation_ids,
            ),
            leaf_receipt_id=str(uuid.uuid4()),
            operation_ids=operation_ids,
            next_ordinal=1,
            operation_receipts=(),
            partial_action_receipt=None,
            observation_attempt=observation_attempt,
        )
        self._validate_leaf_operation_run(step.id, run, None)
        self.leaf_operation_runs[step.id] = run
        return run

    @staticmethod
    def _validate_leaf_operation_observation(
        observation: dict[str, Any],
        *,
        run: LeafOperationRunSnapshot,
        operation_id: str,
        ordinal: int,
        before_sha256: str,
        after_sha256: str,
    ) -> None:
        expected_detail_keys = {
            "status",
            "direction",
            "operationOrdinal",
            "operationId",
            "mutating",
            "receiptId",
            "runId",
            "stepId",
            "actionName",
            "recipeId",
            "catalogVersion",
            "beforeFingerprintSha256",
            "afterFingerprintSha256",
            "evidence",
        }
        profile = GUIDED_LEAF_OPERATION_OBSERVATION_PROFILES.get(run.action_name)
        if profile is None:
            raise ValueError("Leaf operation observation profile is unavailable")
        observation_kind, completion_evidence_key, mutating_ordinals = profile
        if (
            not isinstance(observation, dict)
            or set(observation) != {"kind", "satisfied", "details"}
            or observation.get("kind") != observation_kind
            or observation.get("satisfied") is not True
            or not isinstance(observation.get("details"), dict)
            or set(observation["details"]) != expected_detail_keys
        ):
            raise ValueError("Leaf operation observation is invalid")
        details = observation["details"]
        expected = {
            "status": "passed",
            "direction": "forward",
            "operationId": operation_id,
            "operationOrdinal": ordinal,
            "mutating": ordinal in mutating_ordinals,
            "receiptId": run.leaf_receipt_id,
            "runId": run.run_id,
            "stepId": run.step_id,
            "actionName": run.action_name,
            "recipeId": run.recipe_id,
            "catalogVersion": run.catalog_version,
            "beforeFingerprintSha256": before_sha256,
            "afterFingerprintSha256": after_sha256,
        }
        if any(details.get(key) != value for key, value in expected.items()):
            raise ValueError("Leaf operation observation does not match its receipt")
        evidence = details["evidence"]
        if (
            not isinstance(evidence, dict)
            or evidence.get("completedOperations") != list(range(1, ordinal + 1))
            or evidence.get("preconditionsValidated") is not (ordinal == 1)
            or evidence.get(completion_evidence_key)
            is not (ordinal == len(run.operation_ids))
        ):
            raise ValueError("Leaf operation observation evidence is invalid")

    @staticmethod
    def _bind_leaf_operation_observation(
        observation: dict[str, Any],
        run: LeafOperationRunSnapshot,
    ) -> dict[str, Any]:
        """Attach trusted run identity without accepting conflicting caller claims."""

        bound = deepcopy(observation)
        details = bound.get("details") if isinstance(bound, dict) else None
        if not isinstance(details, dict):
            return bound
        bindings = {
            "runId": run.run_id,
            "recipeId": run.recipe_id,
            "catalogVersion": run.catalog_version,
        }
        for key, expected in bindings.items():
            if key in details and details[key] != expected:
                raise ValueError(
                    "Leaf operation observation does not match its receipt binding"
                )
        details.update(bindings)
        return bound

    @staticmethod
    def _leaf_operation_partial_receipt_required(
        action_name: str, completed_count: int
    ) -> bool:
        profile = GUIDED_LEAF_OPERATION_OBSERVATION_PROFILES.get(action_name)
        if profile is None:
            raise ValueError("Leaf operation observation profile is unavailable")
        return any(ordinal <= completed_count for ordinal in profile[2])

    @staticmethod
    def _copy_leaf_operation_run(
        run: LeafOperationRunSnapshot,
    ) -> LeafOperationRunSnapshot:
        """Copy logical evidence while preserving Blender-bound receipt objects."""

        return replace(
            run,
            operation_receipts=tuple(
                replace(receipt, observation=deepcopy(receipt.observation))
                for receipt in run.operation_receipts
            ),
        )

    @classmethod
    def _trusted_replay_logical_value(cls, value: Any) -> Any:
        """Remove only process-local Blender identity fields for replay comparison."""

        if is_dataclass(value) and not isinstance(value, type):
            return (
                type(value),
                tuple(
                    (
                        field.name,
                        "<process-local>"
                        if field.name in {"pointer", "session_uid"}
                        else cls._trusted_replay_logical_value(
                            getattr(value, field.name)
                        ),
                    )
                    for field in fields(value)
                ),
            )
        if isinstance(value, tuple):
            return tuple(cls._trusted_replay_logical_value(item) for item in value)
        if isinstance(value, list):
            return tuple(cls._trusted_replay_logical_value(item) for item in value)
        if isinstance(value, Mapping):
            return tuple(
                sorted(
                    (
                        key,
                        cls._trusted_replay_logical_value(item),
                    )
                    for key, item in value.items()
                )
            )
        return value

    def rebase_leaf_operation_replay(
        self,
        snapshot: SessionSnapshot,
        *,
        step_id: str,
        original_run: LeafOperationRunSnapshot,
        replayed_run: LeafOperationRunSnapshot,
    ) -> SessionSnapshot:
        """Validate one internally replayed prefix and rebase its ephemeral IDs.

        This is intentionally narrower than native-history restore: only executor
        evidence, fingerprints, and process-local identities created by the same
        receipt may change. Plan/run/catalog/order/target bindings remain exact.
        """

        if not isinstance(snapshot, SessionSnapshot):
            raise TypeError("Trusted leaf replay requires a SessionSnapshot")
        snapshot_runs = dict(snapshot.leaf_operation_runs)
        if len(snapshot_runs) != len(snapshot.leaf_operation_runs):
            raise ValueError("Trusted leaf replay snapshot has duplicate runs")
        recorded_run = snapshot_runs.get(step_id)
        if recorded_run != original_run or original_run.status != "in_progress":
            raise ValueError("Trusted leaf replay does not match the prepared run")
        if not isinstance(replayed_run, LeafOperationRunSnapshot) or replace(
            replayed_run,
            operation_receipts=original_run.operation_receipts,
            partial_action_receipt=original_run.partial_action_receipt,
        ) != original_run:
            raise ValueError("Trusted leaf replay changed the run binding")
        if len(replayed_run.operation_receipts) != len(
            original_run.operation_receipts
        ):
            raise ValueError("Trusted leaf replay changed the operation prefix")
        for original, replayed in zip(
            original_run.operation_receipts,
            replayed_run.operation_receipts,
            strict=True,
        ):
            if replace(
                replayed,
                before_sha256=original.before_sha256,
                after_sha256=original.after_sha256,
                observation=original.observation,
            ) != original:
                raise ValueError("Trusted leaf replay changed operation identity")
        if replayed_run.operation_receipts and (
            replayed_run.operation_receipts[0].before_sha256
            != original_run.operation_receipts[0].before_sha256
        ):
            raise ValueError("Trusted leaf replay changed the external precondition")

        original_partial = original_run.partial_action_receipt
        replayed_partial = replayed_run.partial_action_receipt
        if (original_partial is None) != (replayed_partial is None):
            raise ValueError("Trusted leaf replay changed the partial receipt shape")
        if original_partial is not None and replayed_partial is not None:
            if (
                replayed_partial.receipt_id != original_partial.receipt_id
                or replayed_partial.step_id != original_partial.step_id
                or replayed_partial.action_name != original_partial.action_name
                or replayed_partial.anchor != original_partial.anchor
                or self._trusted_replay_logical_value(replayed_partial.created)
                != self._trusted_replay_logical_value(original_partial.created)
                or self._trusted_replay_logical_value(replayed_partial.mutations)
                != self._trusted_replay_logical_value(original_partial.mutations)
                or replayed_partial.artifacts != original_partial.artifacts
            ):
                raise ValueError("Trusted leaf replay changed logical action effects")
            created_ids = {
                identity.logical_id for identity in original_partial.created
            }
            for original, replayed in zip(
                original_partial.mutations,
                replayed_partial.mutations,
                strict=True,
            ):
                if (
                    original.resource.logical_id not in created_ids
                    and replayed.resource != original.resource
                ):
                    raise ValueError(
                        "Trusted leaf replay changed an external resource identity"
                    )

        self._validate_leaf_operation_run(
            step_id,
            replayed_run,
            dict(snapshot.receipts).get(step_id),
        )
        rebased_runs = tuple(
            (
                candidate_step_id,
                self._copy_leaf_operation_run(replayed_run)
                if candidate_step_id == step_id
                else candidate_run,
            )
            for candidate_step_id, candidate_run in snapshot.leaf_operation_runs
        )
        return replace(snapshot, leaf_operation_runs=rebased_runs)

    @staticmethod
    def _validate_leaf_operation_digest(value: str) -> None:
        if re.fullmatch(r"[0-9a-f]{64}", value) is None:
            raise ValueError("Leaf operation fingerprint must be a SHA-256 digest")

    def _validate_leaf_operation_run(
        self,
        step_id: str,
        run: LeafOperationRunSnapshot,
        formal_receipt: ActionReceipt | None,
    ) -> None:
        """Validate the complete logical and receipt identity of one leaf run."""

        step = self._nodes_by_id.get(step_id)
        if (
            not isinstance(run, LeafOperationRunSnapshot)
            or step is None
            or step.action is None
            or run.step_id != step_id
            or run.action_name != step.action.name
            or not run.run_id
            or not run.recipe_id
            or not run.catalog_version
            or not run.leaf_receipt_id
            or run.status not in {"in_progress", "completed"}
            or isinstance(run.observation_attempt, bool)
            or not isinstance(run.observation_attempt, int)
            or run.observation_attempt < 1
            or not isinstance(run.operation_ids, tuple)
            or not run.operation_ids
            or len(set(run.operation_ids)) != len(run.operation_ids)
            or any(
                not isinstance(operation_id, str) or not operation_id
                for operation_id in run.operation_ids
            )
            or not isinstance(run.operation_receipts, tuple)
            or isinstance(run.next_ordinal, bool)
            or not isinstance(run.next_ordinal, int)
            or run.next_ordinal != len(run.operation_receipts) + 1
            or not 1 <= run.next_ordinal <= len(run.operation_ids) + 1
        ):
            raise ValueError("Leaf operation run state is invalid")
        expected_binding = self._leaf_operation_binding_sha256(
            step,
            run.recipe_id,
            run.catalog_version,
            run.operation_ids,
        )
        if run.binding_sha256 != expected_binding:
            raise ValueError("Leaf operation binding is invalid")

        previous_after: str | None = None
        for ordinal, receipt in enumerate(run.operation_receipts, start=1):
            if (
                not isinstance(receipt, LeafOperationReceipt)
                or receipt.run_id != run.run_id
                or receipt.step_id != step_id
                or receipt.action_name != run.action_name
                or receipt.recipe_id != run.recipe_id
                or receipt.operation_id != run.operation_ids[ordinal - 1]
                or receipt.ordinal != ordinal
            ):
                raise ValueError("Leaf operation receipt identity is invalid")
            self._validate_leaf_operation_digest(receipt.before_sha256)
            self._validate_leaf_operation_digest(receipt.after_sha256)
            if previous_after is not None and receipt.before_sha256 != previous_after:
                raise ValueError("Leaf operation fingerprints are not continuous")
            self._validate_leaf_operation_observation(
                receipt.observation,
                run=run,
                operation_id=receipt.operation_id,
                ordinal=receipt.ordinal,
                before_sha256=receipt.before_sha256,
                after_sha256=receipt.after_sha256,
            )
            previous_after = receipt.after_sha256

        partial = run.partial_action_receipt
        if partial is not None and (
            not isinstance(partial, ActionReceipt)
            or partial.receipt_id != run.leaf_receipt_id
            or partial.step_id != step_id
            or partial.action_name != run.action_name
        ):
            raise ValueError("Partial leaf receipt identity is invalid")
        completed_count = len(run.operation_receipts)
        if run.status == "in_progress":
            if formal_receipt is not None:
                raise ValueError("Pending leaf run collides with a formal receipt")
            if self._leaf_operation_partial_receipt_required(
                run.action_name, completed_count
            ) != (partial is not None):
                raise ValueError("Pending leaf run has an invalid partial receipt")
            return
        if (
            completed_count != len(run.operation_ids)
            or partial is not None
            or formal_receipt is None
            or not isinstance(formal_receipt, ActionReceipt)
            or formal_receipt.receipt_id != run.leaf_receipt_id
            or formal_receipt.step_id != step_id
            or formal_receipt.action_name != run.action_name
        ):
            raise ValueError("Completed leaf run has an invalid formal receipt")

    def record_leaf_operation(
        self,
        step: TaskNode,
        *,
        run_id: str,
        operation_id: str,
        ordinal: int,
        before_sha256: str,
        after_sha256: str,
        observation: dict[str, Any],
        partial_action_receipt: ActionReceipt | None,
    ) -> LeafOperationRunSnapshot:
        """Commit one already-verified microstep to the session-side hash chain."""

        run = self.pending_leaf_operation_run
        if run is None or run.step_id != step.id or run.run_id != run_id:
            raise ValueError("Leaf operation transaction is unavailable or stale")
        if step is not self.guidance_step or step.action is None:
            raise ValueError("Leaf operation execution is no longer current")
        self._validate_leaf_operation_run(
            step.id,
            run,
            self.receipts.get(step.id),
        )
        if run.binding_sha256 != self._leaf_operation_binding_sha256(
            step,
            run.recipe_id,
            run.catalog_version,
            run.operation_ids,
        ):
            raise ValueError("Leaf operation binding changed")
        if ordinal != run.next_ordinal or ordinal > len(run.operation_ids):
            raise ValueError("Leaf operation must execute in catalog order")
        if operation_id != run.operation_ids[ordinal - 1]:
            raise ValueError("Leaf operation id does not match its ordinal")
        self._validate_leaf_operation_digest(before_sha256)
        self._validate_leaf_operation_digest(after_sha256)
        observation = self._bind_leaf_operation_observation(observation, run)
        self._validate_leaf_operation_observation(
            observation,
            run=run,
            operation_id=operation_id,
            ordinal=ordinal,
            before_sha256=before_sha256,
            after_sha256=after_sha256,
        )
        if (
            run.operation_receipts
            and before_sha256 != run.operation_receipts[-1].after_sha256
        ):
            raise ValueError("Leaf operation fingerprints do not form a continuous chain")
        receipt_required = self._leaf_operation_partial_receipt_required(
            run.action_name, ordinal
        )
        if receipt_required != (partial_action_receipt is not None):
            if ordinal == 1 and partial_action_receipt is not None:
                raise ValueError(
                    "The navigation precondition cannot create a scene receipt"
                )
            raise ValueError(
                "Leaf operation partial receipt does not match its mutation prefix"
            )
        if partial_action_receipt is not None:
            if (
                partial_action_receipt.receipt_id != run.leaf_receipt_id
                or partial_action_receipt.step_id != step.id
                or partial_action_receipt.action_name != step.action.name
            ):
                raise ValueError("Partial leaf receipt does not match the transaction")
        logical_receipt = LeafOperationReceipt(
            run_id=run.run_id,
            step_id=run.step_id,
            action_name=run.action_name,
            recipe_id=run.recipe_id,
            operation_id=operation_id,
            ordinal=ordinal,
            before_sha256=before_sha256,
            after_sha256=after_sha256,
            observation=observation,
        )
        updated = replace(
            run,
            next_ordinal=ordinal + 1,
            operation_receipts=(*run.operation_receipts, logical_receipt),
            partial_action_receipt=partial_action_receipt,
        )
        self._validate_leaf_operation_run(step.id, updated, None)
        self.leaf_operation_runs[step.id] = updated
        return updated

    def discard_empty_leaf_operation_run(self, *, run_id: str) -> None:
        """Remove a just-opened transaction when its first precondition failed."""

        run = self.pending_leaf_operation_run
        if run is None or run.run_id != run_id:
            raise ValueError("Leaf operation transaction is unavailable or stale")
        if run.operation_receipts or run.partial_action_receipt is not None:
            raise ValueError("A started leaf operation transaction must be aborted")
        del self.leaf_operation_runs[run.step_id]

    def rewind_leaf_operation(
        self,
        step: TaskNode,
        *,
        run_id: str,
        operation_id: str,
        ordinal: int,
        partial_action_receipt: ActionReceipt | None,
    ) -> LeafOperationRunSnapshot | None:
        """Record a successfully compensated LIFO microstep."""

        run = self.pending_leaf_operation_run
        if run is None or run.step_id != step.id or run.run_id != run_id:
            raise ValueError("Leaf operation transaction is unavailable or stale")
        self._validate_leaf_operation_run(
            step.id,
            run,
            self.receipts.get(step.id),
        )
        if not run.operation_receipts:
            raise ValueError("No executed leaf operation is available to rewind")
        latest = run.operation_receipts[-1]
        if latest.operation_id != operation_id or latest.ordinal != ordinal:
            raise ValueError("Only the latest leaf operation can be rewound")
        remaining = run.operation_receipts[:-1]
        receipt_required = self._leaf_operation_partial_receipt_required(
            run.action_name, len(remaining)
        )
        if receipt_required != (partial_action_receipt is not None):
            raise ValueError(
                "Rewound leaf receipt does not match its remaining mutation prefix"
            )
        if not remaining:
            del self.leaf_operation_runs[step.id]
            return None
        updated = replace(
            run,
            next_ordinal=ordinal,
            operation_receipts=remaining,
            partial_action_receipt=partial_action_receipt,
        )
        self._validate_leaf_operation_run(step.id, updated, None)
        self.leaf_operation_runs[step.id] = updated
        return updated

    def complete_leaf_operation_run(
        self,
        step: TaskNode,
        *,
        run_id: str,
    ) -> LeafOperationRunSnapshot:
        """Promote a fully verified partial receipt into the canonical leaf receipt."""

        run = self.pending_leaf_operation_run
        if run is None or run.step_id != step.id or run.run_id != run_id:
            raise ValueError("Leaf operation transaction is unavailable or stale")
        if step is not self.guidance_step or step.action is None:
            raise ValueError("Leaf operation completion is no longer current")
        self._validate_leaf_operation_run(
            step.id,
            run,
            self.receipts.get(step.id),
        )
        if (
            run.next_ordinal != len(run.operation_ids) + 1
            or len(run.operation_receipts) != len(run.operation_ids)
        ):
            raise ValueError("All leaf operations must pass before promotion")
        receipt = run.partial_action_receipt
        if receipt is None or (
            receipt.receipt_id != run.leaf_receipt_id
            or receipt.step_id != step.id
            or receipt.action_name != step.action.name
        ):
            raise ValueError("The completed leaf has no matching partial receipt")
        next_index = self.active_index + 1
        if next_index >= len(self.steps) or self.steps[next_index] is not step:
            raise ValueError("Leaf operation completion is out of traversal order")
        if step.id in self.receipts:
            raise ValueError("The leaf already has a formal receipt")

        policy = step.observation_policy
        observations: list[dict[str, Any]] = []
        if policy is not None and policy.mode == "success_gate":
            candidate_receipts = dict(self.receipts)
            candidate_receipts[step.id] = receipt
            observations = self._evaluate_step(step, candidate_receipts)
            if not observations or not all(
                observation["satisfied"] for observation in observations
            ):
                message = self._gate_message(step, observations)
                if policy.failure_strategy == "rollback_step":
                    _execute, rollback = self._step_actions(step)
                    try:
                        rollback(receipt)
                    except Exception as rollback_error:
                        self.receipts[step.id] = receipt
                        completed = replace(
                            run,
                            partial_action_receipt=None,
                            status="completed",
                        )
                        self._validate_leaf_operation_run(
                            step.id,
                            completed,
                            receipt,
                        )
                        self.leaf_operation_runs[step.id] = completed
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
                        self._ensure_guidance_path_expanded()
                        raise ObservationGateError(step, gate) from rollback_error
                    del self.leaf_operation_runs[step.id]
                    retry = None
                    status = "failed_rolled_back"
                    retry_message = "the leaf operation run was rolled back"
                    if policy.retry_mode == "automatic_bounded":
                        remaining_attempts = (
                            policy.max_attempts - run.observation_attempt
                        )
                        disposition = (
                            "scheduled" if remaining_attempts > 0 else "exhausted"
                        )
                        status = (
                            "retry_scheduled"
                            if disposition == "scheduled"
                            else "failed_rolled_back"
                        )
                        retry = {
                            "mode": "automatic_bounded",
                            "attempt": run.observation_attempt,
                            "maxAttempts": policy.max_attempts,
                            "remainingAttempts": remaining_attempts,
                            "disposition": disposition,
                        }
                        retry_message = (
                            f"retry {run.observation_attempt + 1} of "
                            f"{policy.max_attempts} scheduled"
                            if disposition == "scheduled"
                            else f"all {policy.max_attempts} attempts exhausted"
                        )
                    gate = self._gate_state(
                        step,
                        status=status,
                        message=f"{message}; {retry_message}",
                        observations=observations,
                        retry=retry,
                    )
                    self.observation_gate = gate
                    self._ensure_guidance_path_expanded()
                    raise ObservationGateError(step, gate)

                self.receipts[step.id] = receipt
                completed = replace(
                    run,
                    partial_action_receipt=None,
                    status="completed",
                )
                self._validate_leaf_operation_run(step.id, completed, receipt)
                self.leaf_operation_runs[step.id] = completed
                self.active_index = next_index
                gate = self._gate_state(
                    step,
                    status="repair_required",
                    message=f"{message}; repair the scene or use Back",
                    observations=observations,
                )
                self.observation_gate = gate
                self._ensure_guidance_path_expanded()
                raise ObservationGateError(step, gate)

            self._last_success_gate_result = (
                step.id,
                tuple(deepcopy(observations)),
            )
            if policy.retry_mode == "automatic_bounded" and run.observation_attempt > 1:
                self._last_success_gate_retry = (
                    step.id,
                    {
                        "mode": "automatic_bounded",
                        "attempts": run.observation_attempt,
                        "maxAttempts": policy.max_attempts,
                        "outcome": "succeeded_after_retry",
                    },
                )

        self.receipts[step.id] = receipt
        completed = replace(
            run,
            partial_action_receipt=None,
            status="completed",
        )
        self._validate_leaf_operation_run(step.id, completed, receipt)
        self.leaf_operation_runs[step.id] = completed
        self.active_index = next_index
        self.observation_gate = None
        self._ensure_guidance_path_expanded()
        return completed

    def abort_leaf_operation_run(self) -> TaskNode | None:
        """Compensate the whole partial aggregate and discard its local evidence."""

        run = self.pending_leaf_operation_run
        if run is None:
            return None
        step = self._nodes_by_id.get(run.step_id)
        if step is None or step is not self.guidance_step:
            raise RuntimeError("Pending leaf operation run is not the guidance step")
        self._validate_leaf_operation_run(
            step.id,
            run,
            self.receipts.get(step.id),
        )
        receipt = run.partial_action_receipt
        if receipt is not None:
            _execute, rollback = self._step_actions(step)
            rollback(receipt)
        del self.leaf_operation_runs[step.id]
        self.observation_gate = None
        self._last_success_gate_result = None
        self._last_success_gate_retry = None
        self._ensure_guidance_path_expanded()
        return step

    def success_gate_observation_copy(
        self,
        step_id: str,
    ) -> list[dict[str, Any]] | None:
        result = self._last_success_gate_result
        if result is None or result[0] != step_id:
            return None
        return deepcopy(list(result[1]))

    def success_gate_retry_copy(self, step_id: str) -> dict[str, Any] | None:
        result = self._last_success_gate_retry
        if result is None or result[0] != step_id:
            return None
        return deepcopy(result[1])

    def snapshot_state(self) -> SessionSnapshot:
        """Capture module state without copying Blender RNA values in receipts."""
        for step_id, run in self.leaf_operation_runs.items():
            self._validate_leaf_operation_run(
                step_id,
                run,
                self.receipts.get(step_id),
            )
        return SessionSnapshot(
            plan_id=self.plan_id,
            revision=self.revision,
            active_index=self.active_index,
            started=self.started,
            execution_id=self.execution_id,
            receipts=tuple(self.receipts.items()),
            leaf_operation_runs=tuple(
                (step_id, self._copy_leaf_operation_run(run))
                for step_id, run in self.leaf_operation_runs.items()
            ),
            observation_gate=deepcopy(self.observation_gate),
            last_success_gate_result=deepcopy(self._last_success_gate_result),
            last_success_gate_retry=deepcopy(self._last_success_gate_retry),
        )

    def restore_state(
        self,
        snapshot: SessionSnapshot,
        *,
        receipts: Mapping[str, ActionReceipt] | None = None,
        leaf_operation_runs: Mapping[str, LeafOperationRunSnapshot] | None = None,
    ) -> None:
        """Restore a checkpoint after Blender has restored its matching ID state."""
        if snapshot.plan_id != self.plan_id or snapshot.revision != self.revision:
            raise ValueError("Native history checkpoint belongs to a different plan")
        if not -1 <= snapshot.active_index < len(self.steps):
            raise ValueError("Native history checkpoint has an invalid active step")
        snapshot_receipts = dict(snapshot.receipts)
        snapshot_runs = dict(snapshot.leaf_operation_runs)
        if len(snapshot_receipts) != len(snapshot.receipts) or len(snapshot_runs) != len(
            snapshot.leaf_operation_runs
        ):
            raise ValueError("Native history checkpoint contains duplicate step state")
        restored_receipts = snapshot_receipts if receipts is None else dict(receipts)
        if leaf_operation_runs is None:
            restored_runs = {
                step_id: self._copy_leaf_operation_run(run)
                for step_id, run in snapshot_runs.items()
            }
        else:
            override_runs = dict(leaf_operation_runs)
            if set(override_runs) != set(snapshot_runs):
                raise ValueError(
                    "Leaf operation restore override changed the checkpoint steps"
                )
            restored_runs = {}
            for step_id, snapshot_run in snapshot_runs.items():
                override_run = override_runs[step_id]
                if not isinstance(override_run, LeafOperationRunSnapshot) or replace(
                    override_run,
                    partial_action_receipt=snapshot_run.partial_action_receipt,
                ) != snapshot_run:
                    raise ValueError(
                        "Leaf operation restore override changed logical checkpoint state"
                    )
                restored_runs[step_id] = self._copy_leaf_operation_run(
                    replace(
                        snapshot_run,
                        partial_action_receipt=override_run.partial_action_receipt,
                    )
                )
        known_step_ids = {step.id for step in self.steps}
        if not set(restored_receipts).issubset(known_step_ids):
            raise ValueError("Native history checkpoint contains unknown receipt steps")
        if not set(restored_runs).issubset(known_step_ids):
            raise ValueError("Native history checkpoint contains unknown leaf operation steps")
        for step_id, run in restored_runs.items():
            self._validate_leaf_operation_run(
                step_id,
                run,
                restored_receipts.get(step_id),
            )
        pending_runs = tuple(
            run for run in restored_runs.values() if run.status == "in_progress"
        )
        if len(pending_runs) > 1:
            raise ValueError("Native history checkpoint has multiple pending leaf runs")
        self.active_index = snapshot.active_index
        self.started = snapshot.started
        self.execution_id = snapshot.execution_id
        self.receipts = restored_receipts
        self.leaf_operation_runs = restored_runs
        self.observation_gate = deepcopy(snapshot.observation_gate)
        self._last_success_gate_result = deepcopy(snapshot.last_success_gate_result)
        self._last_success_gate_retry = deepcopy(snapshot.last_success_gate_retry)
        self._ensure_guidance_path_expanded()

    def abandon_state(self) -> None:
        """Forget Python receipts when Blender replaces the entire loaded file."""
        self.receipts.clear()
        self.leaf_operation_runs.clear()
        self.active_index = -1
        self.started = False
        self.execution_id = None
        self.observation_gate = None
        self._last_success_gate_result = None
        self._last_success_gate_retry = None
        self._ensure_guidance_path_expanded()

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

    def _evaluate_step(
        self,
        step: TaskNode,
        receipts: Mapping[str, ActionReceipt] | None = None,
    ) -> list[dict[str, Any]]:
        evaluator = self._observation_evaluator
        if evaluator is None:
            return self._failed_observations(step, "EvaluatorUnavailable")
        try:
            observations = evaluator(
                step.expected_observations,
                self.receipts if receipts is None else receipts,
            )
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
        retry: dict[str, Any] | None = None,
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
            retry=deepcopy(retry),
        )

    def next(self, observation_attempt: int = 1) -> TaskNode | None:
        if not self.started:
            self.start()
        pending_run = self.pending_leaf_operation_run
        if pending_run is not None:
            raise ValueError(
                "Finish or abort the current leaf operation run before atomic Next"
            )
        if self.observation_blocked:
            gate = self.observation_gate
            step = self.active_step
            if gate is None or step is None:
                raise RuntimeError("Observation gate state is inconsistent")
            self._ensure_guidance_path_expanded()
            raise ObservationGateError(step, gate)
        previous_gate = self.observation_gate
        next_index = self.active_index + 1
        if next_index >= len(self.steps):
            self.observation_gate = None
            self._last_success_gate_result = None
            self._last_success_gate_retry = None
            self._ensure_guidance_path_expanded()
            return None
        step = self.steps[next_index]
        policy = step.observation_policy
        max_attempts = (
            policy.max_attempts
            if policy is not None and policy.retry_mode == "automatic_bounded"
            else 1
        )
        expected_attempt = 1
        if (
            previous_gate is not None
            and previous_gate.step_id == step.id
            and previous_gate.status == "retry_scheduled"
            and previous_gate.retry is not None
        ):
            expected_attempt = previous_gate.retry["attempt"] + 1
        if (
            isinstance(observation_attempt, bool)
            or not isinstance(observation_attempt, int)
            or observation_attempt < 1
            or observation_attempt > max_attempts
            or observation_attempt != expected_attempt
        ):
            raise ValueError(f"Invalid Observation attempt for {step.id}")
        self.observation_gate = None
        self._last_success_gate_result = None
        self._last_success_gate_retry = None
        execute, rollback = self._step_actions(step)
        try:
            receipt = execute(self.receipts)
        except Exception:
            self._ensure_guidance_path_expanded()
            raise
        action_name = step.action.name if step.action else ""
        if receipt.step_id != step.id or receipt.action_name != action_name:
            self._ensure_guidance_path_expanded()
            raise RuntimeError(f"Action returned a receipt for the wrong step: {step.id}")
        self.receipts[step.id] = receipt
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
                        self._ensure_guidance_path_expanded()
                        raise ObservationGateError(step, gate) from rollback_error
                    del self.receipts[step.id]
                    retry = None
                    status = "failed_rolled_back"
                    retry_message = "the step was rolled back"
                    if policy.retry_mode == "automatic_bounded":
                        remaining_attempts = policy.max_attempts - observation_attempt
                        disposition = (
                            "scheduled" if remaining_attempts > 0 else "exhausted"
                        )
                        status = (
                            "retry_scheduled"
                            if disposition == "scheduled"
                            else "failed_rolled_back"
                        )
                        retry = {
                            "mode": "automatic_bounded",
                            "attempt": observation_attempt,
                            "maxAttempts": policy.max_attempts,
                            "remainingAttempts": remaining_attempts,
                            "disposition": disposition,
                        }
                        retry_message = (
                            f"retry {observation_attempt + 1} of "
                            f"{policy.max_attempts} scheduled"
                            if disposition == "scheduled"
                            else f"all {policy.max_attempts} attempts exhausted"
                        )
                    gate = self._gate_state(
                        step,
                        status=status,
                        message=f"{message}; {retry_message}",
                        observations=observations,
                        retry=retry,
                    )
                    self.observation_gate = gate
                    self._ensure_guidance_path_expanded()
                    raise ObservationGateError(step, gate)
                self.active_index = next_index
                gate = self._gate_state(
                    step,
                    status="repair_required",
                    message=f"{message}; repair the scene or use Back",
                    observations=observations,
                )
                self.observation_gate = gate
                self._ensure_guidance_path_expanded()
                raise ObservationGateError(step, gate)
            self._last_success_gate_result = (
                step.id,
                tuple(deepcopy(observations)),
            )
            if policy.retry_mode == "automatic_bounded" and observation_attempt > 1:
                self._last_success_gate_retry = (
                    step.id,
                    {
                        "mode": "automatic_bounded",
                        "attempts": observation_attempt,
                        "maxAttempts": policy.max_attempts,
                        "outcome": "succeeded_after_retry",
                    },
                )
        self.active_index = next_index
        self._ensure_guidance_path_expanded()
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
            self._last_success_gate_retry = None
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
        if self.pending_leaf_operation_run is not None:
            raise ValueError(
                "Use Operation Back or Abort before rolling back a completed plan step"
            )
        step = self.active_step
        if step is None:
            self._ensure_guidance_path_expanded()
            return None
        _execute, rollback = self._step_actions(step)
        receipt = self.receipts.get(step.id)
        if receipt is not None:
            try:
                rollback(receipt)
            except Exception:
                self._ensure_guidance_path_expanded()
                raise
            del self.receipts[step.id]
        completed_run = self.leaf_operation_runs.get(step.id)
        if completed_run is not None:
            if completed_run.status != "completed":
                raise RuntimeError("Leaf operation run state is inconsistent")
            del self.leaf_operation_runs[step.id]
        self.active_index -= 1
        self.observation_gate = None
        self._last_success_gate_result = None
        self._last_success_gate_retry = None
        self._ensure_guidance_path_expanded()
        return step

    def is_expanded(self, node_id: str) -> bool:
        return node_id in self.expanded_node_ids

    def toggle_expanded(self, node_id: str) -> None:
        if node_id not in self._branch_node_ids:
            return
        if node_id in self.expanded_node_ids:
            if node_id in self._guidance_path_branch_ids():
                return
            self.expanded_node_ids.remove(node_id)
        else:
            self.expanded_node_ids.add(node_id)

    def reset(self) -> None:
        self.abort_leaf_operation_run()
        while self.active_step is not None:
            self.back()
        self.receipts.clear()
        self.leaf_operation_runs.clear()
        self.active_index = -1
        self.started = False
        self.execution_id = None
        self.observation_gate = None
        self._last_success_gate_result = None
        self._last_success_gate_retry = None
        self._ensure_guidance_path_expanded()
