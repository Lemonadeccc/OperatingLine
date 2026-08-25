"""Background HTTP transport for the Blender companion.

This module intentionally has no Blender imports.  Worker threads exchange only
plain JSON-compatible messages with the main-thread companion controller.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import socket
import struct
import threading
import time
import uuid
from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from http.client import HTTPConnection, HTTPException, HTTPResponse
from queue import Empty, Queue
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit, urlunsplit

from ..domain import (
    BLENDER_ACTION_CATALOG_VERSION,
    PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    is_action_level_mcp_action,
)
from ..domain.provider_authorization import validate_provider_call_authorization
from ..domain.guided_geometry_leaf_profiles import (
    GUIDED_GEOMETRY_LEAF_OPERATION_PROFILES,
    GUIDED_LEAF_OPERATION_OBSERVATION_PROFILES,
    LIGHT_TRAILS_LEAF_OPERATION_ACTION,
    LIGHT_TRAILS_LEAF_OPERATION_IDS,
    LIGHT_TRAILS_LEAF_OPERATION_RECIPE,
    TRANSFORM_GEOMETRY_LEAF_OPERATION_ACTION,
    TRANSFORM_GEOMETRY_LEAF_OPERATION_IDS,
    TRANSFORM_GEOMETRY_LEAF_OPERATION_RECIPE,
)
from ..domain.task_tree import validate_candidate_menu_projection_data

MAX_RESPONSE_BYTES = 4 * 1024 * 1024
REPLAN_RUN_STATUSES = frozenset(
    {
        "queued",
        "generating",
        "needs_revision",
        "proposal_created",
        "failed",
        "interrupted",
    }
)
TERMINAL_REPLAN_RUN_STATUSES = REPLAN_RUN_STATUSES - {"queued", "generating"}
INITIAL_PLAN_RUN_STATUSES = REPLAN_RUN_STATUSES
TERMINAL_INITIAL_PLAN_RUN_STATUSES = TERMINAL_REPLAN_RUN_STATUSES
DIALOGUE_RUN_STATUSES = frozenset(
    {
        "queued",
        "streaming",
        "replanning",
        "answered",
        "needs_revision",
        "proposal_created",
        "failed",
        "interrupted",
    }
)
TERMINAL_DIALOGUE_RUN_STATUSES = DIALOGUE_RUN_STATUSES - {
    "queued",
    "streaming",
    "replanning",
}
CONTENT_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")
PORTABLE_AUTHORITY_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]*")
COMPANION_SESSION_CONTRACT_VERSION = "1.1.0"
NATIVE_UNDO_PROTOCOL_VERSIONS = frozenset({"1.5.0", "1.6.0", "1.7.0"})
EXECUTION_TRACK_PROTOCOL_VERSIONS = frozenset({"1.6.0", "1.7.0"})
BLENDER_ADAPTER_CAPABILITIES = {
    "presentation": {
        "taskTree": "native",
        "viewportOverlay": "native",
        "interactiveAnchors": "emulated",
    },
    "execution": {
        "inspect": "native",
        "invokeActions": "native",
        "screenshot": "native",
        "rollbackModes": ["compensating_action", "native_undo"],
    },
    "runtime": {
        "dispatch": "main_thread_serial",
        "network": "native",
        "persistentProjectState": "native",
    },
}
MENU_CONTROL_PROOF_EXECUTOR_ID = "blender.uv_sphere_menu_controls.event_simulate.v1"
EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID = "blender.mesh_edit_subdivide_f3_f9.event_simulate.v1"
EDIT_SUBDIVIDE_SHORTCUT_OPERATION_IDS = [
    "shortcut.enter_edit_mode",
    "shortcut.select_all_mesh_elements",
    "shortcut.search_subdivide",
    "shortcut.execute_subdivide",
    "shortcut.open_adjust_last_operation",
    "shortcut.set_number_of_cuts",
    "shortcut.set_smoothness",
    "shortcut.close_adjust_last_operation",
    "shortcut.return_to_object_mode",
]
MENU_CONTROL_PROOF_TARGET_PROFILE = "factory_layout_three_object_ui_scale_2"
MENU_CONTROL_PROOF_OPERATION_IDS = (
    "workspace.layout",
    "menu.add",
    "menu.mesh",
    "operator.uv_sphere",
    "control.location",
    "control.scale",
    "control.object_name",
)
MENU_CONTROL_PROOF_MUTATION_STAGES = (
    "uv_sphere_created",
    "location_x_set",
    "location_y_set",
    "location_z_set",
    "scale_x_set",
    "scale_y_set",
    "scale_z_set",
    "object_name_set",
)
LEAF_OPERATION_AUTHORITY_KEYS = (
    "formatVersion",
    "requestId",
    "replayId",
    "target",
    "proposalId",
    "plan",
    "planContentSha256",
    "executionId",
    "leafId",
    "stepId",
    "actionName",
    "recipeId",
    "catalogVersion",
    "interactionCatalogContentSha256",
    "materializationContentSha256",
    "mcpTrackContentSha256",
    "expectedState",
    "operationIds",
    "operationOrdinal",
    "sourceOperationId",
    "operationParameters",
)


@dataclass(frozen=True)
class CompanionSessionSnapshot:
    """Immutable worker-owned view of one negotiated companion lease."""

    lease_id: str
    session_id: str
    document_incarnation_id: str
    negotiated_guide_protocol_version: str
    heartbeat_interval_seconds: float
    expires_at: str
    next_heartbeat_at: float
    heartbeat_sequence: int


@dataclass
class _LeaseRefreshRequest:
    """Main-thread request serviced by the transport's sole network thread."""

    minimum_validity_seconds: float
    completed: threading.Event
    lease: dict[str, Any] | None = None
    error: str | None = None


def validate_companion_url(value: str) -> str:
    """Return a normalized HTTP loopback URL or raise ``ValueError``."""
    if not isinstance(value, str):
        raise ValueError("Runtime URL must be text")
    parsed = urlsplit(value.strip())
    if parsed.scheme != "http":
        raise ValueError("Runtime URL must use http")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Runtime URL must not contain credentials")
    if parsed.query or parsed.fragment:
        raise ValueError("Runtime URL must not contain a query or fragment")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Runtime URL must include a loopback host")
    is_loopback = hostname.lower() == "localhost"
    if not is_loopback:
        try:
            is_loopback = ipaddress.ip_address(hostname).is_loopback
        except ValueError:
            is_loopback = False
    if not is_loopback:
        raise ValueError("Runtime URL is restricted to loopback hosts")
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("Runtime URL has an invalid port") from error
    netloc = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None:
        netloc = f"{netloc}:{port}"
    path = parsed.path.rstrip("/")
    return urlunsplit(("http", netloc, path, "", ""))


class CompanionTransport:
    """Poll plans/proposals and post reports/decisions on one background thread."""

    def __init__(
        self,
        base_url: str,
        token: str,
        instance_id: str,
        *,
        session_id: str,
        document_incarnation_id: str,
        known_plan_id: str | None = None,
        known_revision: int | None = None,
        known_plan_content_sha256: str | None = None,
        known_proposal_id: str | None = None,
        known_revision_thread_id: str | None = None,
        companion_version: str = "0.1.0",
        host_version: str = "unknown",
        poll_interval: float = 1.0,
        timeout: float = 0.75,
    ) -> None:
        self.base_url = validate_companion_url(base_url)
        if not isinstance(token, str) or len(token) < 16:
            raise ValueError("Bearer token must contain at least 16 characters")
        self._token = token
        self._instance_id = instance_id
        self._session_id = self._validated_uuid(session_id, "Companion session id")
        self._document_incarnation_id = self._validated_uuid(
            document_incarnation_id,
            "Companion document incarnation id",
        )
        if not isinstance(companion_version, str) or not companion_version.strip():
            raise ValueError("Companion version must be non-empty text")
        if not isinstance(host_version, str) or not host_version.strip():
            raise ValueError("Host version must be non-empty text")
        self._companion_version = companion_version
        self._host_version = host_version
        if (
            isinstance(poll_interval, bool)
            or not isinstance(poll_interval, (int, float))
            or poll_interval <= 0
        ):
            raise ValueError("Poll interval must be positive")
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or timeout <= 0:
            raise ValueError("HTTP timeout must be positive")
        self._poll_interval = poll_interval
        self._timeout = timeout
        self.incoming: Queue[dict[str, Any]] = Queue()
        self.outgoing: Queue[dict[str, Any]] = Queue()
        self.decisions: Queue[dict[str, Any]] = Queue()
        self.revision_requests: Queue[dict[str, Any]] = Queue()
        self.goal_requests: Queue[dict[str, Any]] = Queue()
        self.replan_runs: Queue[dict[str, Any]] = Queue()
        self.dialogue_runs: Queue[dict[str, Any]] = Queue()
        self.initial_plan_runs: Queue[dict[str, Any]] = Queue()
        self.action_results: Queue[dict[str, Any]] = Queue()
        self.leaf_operation_results: Queue[dict[str, Any]] = Queue()
        self.leaf_operation_recovery_acks: Queue[dict[str, Any]] = Queue()
        self.poke_compound_results: Queue[dict[str, Any]] = Queue()
        self.poke_compound_recovery_acks: Queue[dict[str, Any]] = Queue()
        self.execution_track_preflight_creates: Queue[dict[str, Any]] = Queue()
        self.execution_track_preflight_status_requests: Queue[str] = Queue()
        self.execution_track_preflight_results: Queue[dict[str, Any]] = Queue()
        self.execution_track_execution_progress: Queue[dict[str, Any]] = Queue()
        self.execution_track_execution_managed_starts: Queue[dict[str, Any]] = Queue()
        self.execution_track_execution_results: Queue[dict[str, Any]] = Queue()
        self.execution_track_execution_recovery_acks: Queue[dict[str, Any]] = Queue()
        self.shortcut_proof_progress: Queue[dict[str, Any]] = Queue()
        self.shortcut_proof_results: Queue[dict[str, Any]] = Queue()
        self.shortcut_proof_recovery_acks: Queue[dict[str, Any]] = Queue()
        self.menu_control_proof_progress: Queue[dict[str, Any]] = Queue()
        self.menu_control_proof_results: Queue[dict[str, Any]] = Queue()
        self.menu_control_proof_history_transitions: Queue[dict[str, Any]] = Queue()
        self.menu_control_proof_recovery_acks: Queue[dict[str, Any]] = Queue()
        self._lease_refresh_requests: Queue[_LeaseRefreshRequest] = Queue()
        self.control: Queue[dict[str, Any]] = Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._flush_deadline = 0.0
        self._last_delivered_sequence = 0
        self._last_delivered_report_identity: tuple[str, int] | None = None
        self._session_snapshot: CompanionSessionSnapshot | None = None
        self._seen_replay_current_state_verification_ids: set[str] = set()
        self._seen_action_request_ids: set[str] = set()
        self._seen_leaf_operation_request_ids: set[str] = set()
        self._seen_leaf_operation_recovery_ids: set[str] = set()
        self._seen_poke_compound_request_ids: set[str] = set()
        self._seen_poke_compound_recovery_ids: set[str] = set()
        self._seen_execution_track_preflight_request_ids: set[str] = set()
        self._seen_execution_track_execution_request_ids: set[str] = set()
        self._inflight_execution_track_execution_request_ids: set[str] = set()
        self._execution_track_execution_recovery_poll_enabled = False
        self._execution_track_preflight_poll_enabled = False
        self._seen_shortcut_proof_request_ids: set[str] = set()
        self._seen_shortcut_proof_recovery_ids: set[str] = set()
        self._seen_menu_control_proof_request_ids: set[str] = set()
        self._seen_menu_control_proof_recovery_ids: set[str] = set()
        self._menu_control_proof_reconciliations: dict[str, dict[str, Any]] = {}
        self._menu_control_proof_inflight_request_id: str | None = None
        self._menu_control_recovery_discovery_lease_id: str | None = None
        self._menu_control_recovery_barrier_lease_id: str | None = None
        self._menu_control_history_transition_hashes: set[str] = set()
        self._menu_control_history_reconciled_hashes: set[str] = set()
        self._menu_control_history_transition_hashes_lock = threading.Lock()
        known_plan_fields = (
            known_plan_id,
            known_revision,
            known_plan_content_sha256,
        )
        provided_known_plan_fields = sum(
            value is not None for value in known_plan_fields
        )
        if provided_known_plan_fields not in (0, len(known_plan_fields)):
            raise ValueError(
                "Known plan id, revision, and content SHA-256 must be provided together"
            )
        if known_plan_content_sha256 is not None and CONTENT_SHA256_PATTERN.fullmatch(
            known_plan_content_sha256
        ) is None:
            raise ValueError(
                "Known plan content SHA-256 must be 64 lowercase hex characters"
            )
        self._known_plan_id = known_plan_id
        self._known_revision = known_revision
        self._known_plan_content_sha256 = known_plan_content_sha256
        self._known_proposal_id = known_proposal_id
        self._revision_thread_id = self._validated_optional_uuid(
            known_revision_thread_id,
            "Known revision thread id",
        )
        self._revision_history_signature: str | None = None
        self._revision_history_before_turn: int | None = None
        self._revision_branches_signature: str | None = None
        parsed_base_url = urlsplit(self.base_url)
        self._host = parsed_base_url.hostname or "127.0.0.1"
        self._port = parsed_base_url.port or 80
        self._base_path = parsed_base_url.path.rstrip("/")
        self._connection_lock = threading.Lock()
        self._active_connection: HTTPConnection | None = None
        self._active_socket: socket.socket | None = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    @property
    def last_delivered_sequence(self) -> int:
        return self._last_delivered_sequence

    @property
    def session_snapshot(self) -> CompanionSessionSnapshot | None:
        return self._session_snapshot

    @property
    def current_document_lease(self) -> dict[str, Any] | None:
        session = self._session_snapshot
        if session is None:
            return None
        return {
            "leaseId": session.lease_id,
            "sessionId": session.session_id,
            "target": {"adapterId": "blender", "instanceId": self._instance_id},
            "documentIncarnationId": session.document_incarnation_id,
            "expiresAt": session.expires_at,
        }

    @staticmethod
    def _lease_validity_seconds(session: CompanionSessionSnapshot) -> float:
        expires_at = datetime.fromisoformat(session.expires_at.replace("Z", "+00:00"))
        return (expires_at - datetime.now(timezone.utc)).total_seconds()

    def document_lease_with_minimum_validity(
        self,
        *,
        minimum_validity_seconds: float = 5.0,
        timeout: float = 2.0,
    ) -> dict[str, Any]:
        """Return a live lease, asking the network thread to heartbeat when needed.

        Blender can retain the GIL while a native UI proof is in progress.  This
        synchronous handoff releases the GIL while preserving the transport's
        single-network-thread boundary.
        """

        if (
            isinstance(minimum_validity_seconds, bool)
            or not isinstance(minimum_validity_seconds, (int, float))
            or minimum_validity_seconds <= 0
        ):
            raise ValueError("Minimum lease validity must be positive")
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or timeout <= 0:
            raise ValueError("Lease refresh timeout must be positive")
        session = self._session_snapshot
        if session is None or not self.running:
            raise RuntimeError("Companion session is not available for lease refresh")
        if self._lease_validity_seconds(session) >= minimum_validity_seconds:
            lease = self.current_document_lease
            if lease is None:
                raise RuntimeError("Companion document lease disappeared")
            return lease
        if threading.current_thread() is self._thread:
            self._send_heartbeat()
            lease = self.current_document_lease
            if lease is None:
                raise RuntimeError("Companion document lease disappeared after heartbeat")
            return lease
        request = _LeaseRefreshRequest(
            minimum_validity_seconds=float(minimum_validity_seconds),
            completed=threading.Event(),
        )
        self._lease_refresh_requests.put(request)
        if not request.completed.wait(float(timeout)):
            raise TimeoutError("Timed out waiting for a fresh Companion document lease")
        if request.error is not None:
            raise RuntimeError(request.error)
        if request.lease is None:
            raise RuntimeError("Companion lease refresh returned no document lease")
        return deepcopy(request.lease)

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="OperatingLineCompanion", daemon=True
        )
        self._thread.start()

    def stop(self, *, flush_timeout: float = 1.5) -> None:
        self._flush_deadline = time.monotonic() + max(0.0, flush_timeout)
        self._stop.set()
        self._close_active_connection()
        self.wait_stopped(0.0)

    def wait_stopped(self, timeout: float) -> bool:
        thread = self._thread
        if thread is None:
            return True
        if thread is threading.current_thread():
            return False
        thread.join(timeout=max(0.0, timeout))
        if thread.is_alive():
            return False
        if self._thread is thread:
            self._thread = None
        return True

    def send_report(self, report: dict[str, Any]) -> None:
        self.outgoing.put(report)

    def submit_action_result(self, result: dict[str, Any]) -> None:
        """Queue a terminal action result after its referenced state report."""
        if not isinstance(result, dict):
            raise ValueError("Action result must be an object")
        self.action_results.put(dict(result))

    def submit_leaf_operation_result(self, result: dict[str, Any]) -> None:
        """Queue one leaf-operation result after any referenced final report."""
        if not isinstance(result, dict):
            raise ValueError("Leaf-operation result must be an object")
        self.leaf_operation_results.put(deepcopy(result))

    def submit_leaf_operation_recovery_ack(self, ack: dict[str, Any]) -> None:
        """Queue a read-only reconciliation proof for one recovery challenge."""
        validated = self._validate_leaf_operation_recovery_ack(ack)
        self.leaf_operation_recovery_acks.put(validated)

    def submit_poke_compound_result(self, result: dict[str, Any]) -> None:
        """Queue a persisted three-leaf Poke compound terminal result."""
        if not isinstance(result, dict):
            raise ValueError("Poke compound result must be an object")
        self.poke_compound_results.put(deepcopy(result))

    def submit_poke_compound_recovery_ack(self, ack: dict[str, Any]) -> None:
        """Queue a replacement-lease Poke compound terminal or quarantine proof."""
        if not isinstance(ack, dict):
            raise ValueError("Poke compound recovery acknowledgement must be an object")
        self.poke_compound_recovery_acks.put(deepcopy(ack))

    def create_execution_track_preflight(self, request: dict[str, Any]) -> None:
        """Queue one client-known, zero-side-effect execution-track preflight."""
        if not isinstance(request, dict):
            raise ValueError("Execution-track preflight request must be an object")
        self.execution_track_preflight_creates.put(deepcopy(request))

    def submit_execution_track_preflight_result(self, result: dict[str, Any]) -> None:
        """Queue one terminal result produced by Blender's main-thread validator."""
        if not isinstance(result, dict):
            raise ValueError("Execution-track preflight result must be an object")
        self.execution_track_preflight_results.put(deepcopy(result))

    def submit_execution_track_execution_progress(self, progress: dict[str, Any]) -> None:
        """Queue one durable v2 execution-track progress record."""
        if not isinstance(progress, dict):
            raise ValueError("Execution-track progress must be an object")
        self.execution_track_execution_progress.put(deepcopy(progress))

    def submit_execution_track_execution_managed_start(
        self, submission: dict[str, Any]
    ) -> None:
        """Queue the durable server handshake immediately before managed mutation."""
        if not isinstance(submission, dict):
            raise ValueError("Execution-track managed start must be an object")
        self.execution_track_execution_managed_starts.put(deepcopy(submission))

    def submit_execution_track_execution_result(self, result: dict[str, Any]) -> None:
        """Queue one durable v2 execution-track terminal result."""
        if not isinstance(result, dict):
            raise ValueError("Execution-track result must be an object")
        self.execution_track_execution_results.put(deepcopy(result))

    def submit_execution_track_execution_recovery_ack(self, ack: dict[str, Any]) -> None:
        """Queue one durable read-only execution-track recovery acknowledgement."""
        if not isinstance(ack, dict):
            raise ValueError("Execution-track recovery acknowledgement must be an object")
        self.execution_track_execution_recovery_acks.put(deepcopy(ack))

    def acknowledge_execution_track_execution_delivery(
        self, request_id: str, *, persisted: bool
    ) -> None:
        """Move delivery dedupe past the main-thread durable persistence boundary."""
        validated = self._validated_required_uuid(
            request_id, "Execution-track execution request id"
        )
        self.control.put(
            {
                "kind": "execution_track_execution_delivery_persisted"
                if persisted
                else "execution_track_execution_delivery_retry",
                "requestId": validated,
            }
        )

    def enable_execution_track_execution_recovery_poll(self) -> None:
        self.control.put({"kind": "execution_track_execution_recovery_poll_enabled"})

    def _apply_execution_track_execution_delivery_ack(
        self, request_id: str, *, persisted: bool
    ) -> None:
        self._inflight_execution_track_execution_request_ids.discard(request_id)
        if not persisted:
            return
        if len(self._seen_execution_track_execution_request_ids) >= 256:
            self._seen_execution_track_execution_request_ids.pop()
        self._seen_execution_track_execution_request_ids.add(request_id)

    def request_execution_track_preflight_status(self, request_id: str) -> None:
        """Queue an authenticated status lookup for one immutable request."""
        validated = self._validated_required_uuid(
            request_id, "Execution-track preflight request id"
        )
        self.execution_track_preflight_status_requests.put(validated)

    @staticmethod
    def _execution_track_preflight_result_identity(
        result: dict[str, Any],
    ) -> dict[str, Any]:
        identity_fields = (
            "formatVersion", "requestId", "replayId", "deliveryId",
            "bindingContentSha256", "target", "leaseId", "proposalId", "planId",
            "planRevision", "executionId", "leafId",
        )
        return {field: deepcopy(result.get(field)) for field in identity_fields}

    @classmethod
    def _downgrade_verified_preflight_authority_change(
        cls, result: dict[str, Any], error: HTTPError
    ) -> dict[str, Any] | None:
        """Convert only Runtime's dedicated verified-authority conflict once upstream."""
        runtime_payload = getattr(error, "runtime_payload", None)
        if (
            error.code != 409
            or not isinstance(runtime_payload, dict)
            or runtime_payload.get("error")
            != "execution_track_preflight_verified_authority_changed"
            or result.get("status") != "verified_unavailable"
            or result.get("authorityVerified") is not True
            or result.get("reasonCode")
            not in {"executor_unavailable", "modality_not_supported"}
        ):
            return None
        identity = cls._execution_track_preflight_result_identity(result)
        message = runtime_payload.get("message")
        detail = (
            message.strip()
            if isinstance(message, str) and message.strip()
            else "Runtime authority changed after local verification"
        )
        downgraded = deepcopy(result)
        downgraded.update(
            {
                "status": "rejected",
                "authorityVerified": False,
                "reasonCode": "authority_invalid",
                "error": detail[:2_000],
                "occurredAt": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            }
        )
        if cls._execution_track_preflight_result_identity(downgraded) != identity:
            raise ValueError("Execution-track preflight downgrade changed immutable identity")
        return downgraded

    @staticmethod
    def _leaf_operation_result_requires_session_retry(error: HTTPError) -> bool:
        """Keep immutable results pending when only the negotiated lease became stale."""
        runtime_payload = getattr(error, "runtime_payload", None)
        return (
            error.code == 409
            and isinstance(runtime_payload, dict)
            and runtime_payload.get("error")
            in {
                "companion_lease_required",
                "lease_identity_mismatch",
                "lease_not_current",
            }
        )

    @classmethod
    def _leaf_operation_recovery_ack_requires_new_challenge(
        cls, error: HTTPError
    ) -> bool:
        """Discard an uncommitted ACK when Runtime rejects its stale live lease."""
        return cls._leaf_operation_result_requires_session_retry(error)

    def submit_shortcut_proof_progress(self, progress: dict[str, Any]) -> None:
        """Queue append-only shortcut receipt progress on its independent channel."""
        validated = self._validate_shortcut_proof_progress(progress)
        self.shortcut_proof_progress.put(dict(validated))

    def submit_shortcut_proof_result(self, result: dict[str, Any]) -> None:
        """Queue terminal or native-history shortcut evidence independently."""
        validated = self._validate_shortcut_proof_result(result)
        self.shortcut_proof_results.put(dict(validated))

    def submit_shortcut_proof_recovery_ack(self, ack: dict[str, Any]) -> None:
        """Queue proof that a persisted native-history marker was rebound."""
        validated = self._validate_shortcut_proof_recovery_ack(ack)
        self.shortcut_proof_recovery_acks.put(dict(validated))

    def submit_menu_control_proof_progress(self, progress: dict[str, Any]) -> None:
        """Queue one strictly validated logical operation prefix."""
        validated = self._validate_menu_control_proof_progress(progress)
        self.menu_control_proof_progress.put(dict(validated))

    def submit_menu_control_proof_result(self, result: dict[str, Any]) -> None:
        """Queue one strictly validated terminal fixed-executor result."""
        validated = self._validate_menu_control_proof_result(result)
        self.menu_control_proof_results.put(dict(validated))

    def submit_menu_control_history_transition(self, report: dict[str, Any]) -> None:
        """Queue one durable native-history transition on its independent FIFO."""
        validated = self._validate_menu_control_history_transition_report(report)
        transition_hash = validated["transitionContentSha256"]
        with self._menu_control_history_transition_hashes_lock:
            if (
                transition_hash in self._menu_control_history_transition_hashes
                or transition_hash in self._menu_control_history_reconciled_hashes
            ):
                return
            self._menu_control_history_transition_hashes.add(transition_hash)
        self.menu_control_proof_history_transitions.put(dict(validated))

    def _release_menu_control_history_transition(
        self, report: dict[str, Any]
    ) -> None:
        transition_hash = report.get("transitionContentSha256")
        if not isinstance(transition_hash, str):
            return
        with self._menu_control_history_transition_hashes_lock:
            self._menu_control_history_transition_hashes.discard(transition_hash)

    def _acknowledge_reconciled_menu_control_history_transitions(
        self, transition_hashes: list[str]
    ) -> None:
        with self._menu_control_history_transition_hashes_lock:
            self._menu_control_history_reconciled_hashes.update(transition_hashes)
            self._menu_control_history_transition_hashes.difference_update(
                transition_hashes
            )

    def _menu_control_history_transition_was_reconciled(
        self, report: dict[str, Any]
    ) -> bool:
        transition_hash = report.get("transitionContentSha256")
        if not isinstance(transition_hash, str):
            return False
        with self._menu_control_history_transition_hashes_lock:
            return transition_hash in self._menu_control_history_reconciled_hashes

    @staticmethod
    def _runtime_error_code(payload: Any) -> str | None:
        if not isinstance(payload, dict):
            return None
        code = payload.get("code")
        if isinstance(code, str):
            return code
        error = payload.get("error")
        if isinstance(error, str):
            return error
        if isinstance(error, dict) and isinstance(error.get("code"), str):
            return error["code"]
        return None

    def submit_menu_control_proof_recovery_ack(self, ack: dict[str, Any]) -> None:
        """Queue proof that a persisted terminal marker matches a recovery challenge."""
        validated = self._validate_menu_control_terminal_reconciliation_ack(ack)
        self.menu_control_proof_recovery_acks.put(dict(validated))

    def accept_plan(
        self,
        plan_id: str,
        revision: int,
        plan_content_sha256: str,
    ) -> None:
        if (
            not isinstance(plan_content_sha256, str)
            or CONTENT_SHA256_PATTERN.fullmatch(plan_content_sha256) is None
        ):
            raise ValueError(
                "Accepted plan content SHA-256 must be 64 lowercase hex characters"
            )
        self.control.put(
            {
                "kind": "plan_accepted",
                "planId": plan_id,
                "revision": revision,
                "planContentSha256": plan_content_sha256,
            }
        )

    @staticmethod
    def _validated_uuid(value: str, label: str) -> str:
        validated = CompanionTransport._validated_optional_uuid(value, label)
        if validated is None:
            raise ValueError(f"{label} must be a UUID")
        if str(uuid.UUID(validated)) != validated:
            raise ValueError(f"{label} must be a canonical UUID")
        return validated

    @staticmethod
    def _validated_optional_uuid(value: str | None, label: str) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError(f"{label} must be a UUID")
        try:
            uuid.UUID(value)
        except ValueError as error:
            raise ValueError(f"{label} must be a UUID") from error
        return value

    def follow_revision_thread(self, thread_id: str | None) -> None:
        validated = self._validated_optional_uuid(thread_id, "Revision thread id")
        self.control.put({"kind": "follow_revision_thread", "threadId": validated})

    def load_revision_history_before(self, before_turn: int) -> None:
        if (
            isinstance(before_turn, bool)
            or not isinstance(before_turn, int)
            or before_turn <= 0
        ):
            raise ValueError("Revision history cursor must be a positive integer")
        self.control.put(
            {"kind": "load_revision_history_before", "beforeTurn": before_turn}
        )

    def submit_revision_request(self, request: dict[str, Any]) -> None:
        request_id = request.get("requestId")
        if not isinstance(request_id, str) or not request_id:
            raise ValueError("Revision request must contain a requestId")
        self.revision_requests.put(request)

    def submit_goal_request(self, request: dict[str, Any]) -> None:
        request_id = request.get("requestId")
        if not isinstance(request_id, str) or not request_id:
            raise ValueError("Goal request must contain a requestId")
        self.goal_requests.put(request)

    def refresh_replan_providers(self) -> None:
        """Queue a short provider-descriptor request on the existing worker."""
        self.control.put({"kind": "refresh_replan_providers"})

    def start_replan_run(self, request: dict[str, Any]) -> None:
        if not isinstance(request, dict):
            raise ValueError("provider_authority_required: replan request must be an object")
        self._validate_exact_keys(
            request,
            {
                "generationRequestId",
                "revisionRequestId",
                "providerId",
                "providerVersion",
                "targetAdapterId",
                "targetInstanceId",
                "authorization",
            },
            "Replan request",
        )
        generation_request_id = request.get("generationRequestId")
        self._validated_required_uuid(
            generation_request_id,
            "Replan generation request id",
        )
        self._validated_required_uuid(
            request.get("revisionRequestId"), "Replan revision request id"
        )
        if (
            not isinstance(request.get("providerId"), str)
            or PORTABLE_AUTHORITY_ID_PATTERN.fullmatch(request["providerId"]) is None
            or not isinstance(request.get("providerVersion"), str)
            or re.fullmatch(
                r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)",
                request["providerVersion"],
            )
            is None
        ):
            raise ValueError("Replan provider binding is invalid")
        if (
            request.get("targetAdapterId") != "blender"
            or request.get("targetInstanceId") != self._instance_id
        ):
            raise ValueError("Replan request targets a different Blender instance")
        validate_provider_call_authorization(
            request.get("authorization"),
            provider_id=request.get("providerId"),
            provider_version=request.get("providerVersion"),
        )
        self.replan_runs.put(request)

    def refresh_dialogue_providers(self) -> None:
        """Queue streamed-dialogue provider discovery on the worker."""
        self.control.put({"kind": "refresh_dialogue_providers"})

    def start_dialogue_run(self, request: dict[str, Any]) -> None:
        del request
        raise ValueError(
            "provider_authority_unavailable: companion dialogue requires signed "
            "packet-bound authority"
        )

    def refresh_initial_plan_providers(self) -> None:
        """Queue an explicit initial-planner provider discovery request."""
        self.control.put({"kind": "refresh_initial_plan_providers"})

    def start_initial_plan_run(self, request: dict[str, Any]) -> None:
        del request
        raise ValueError(
            "provider_authority_unavailable: companion initial planning requires "
            "signed packet-bound authority"
        )

    def decide_proposal(self, proposal_id: str, decision: str) -> None:
        session = self._session_snapshot
        self.submit_proposal_decision(
            {
                "protocolVersion": (
                    PROTOCOL_VERSION
                    if session is None
                    else session.negotiated_guide_protocol_version
                ),
                "decisionId": str(uuid.uuid4()),
                "proposalId": proposal_id,
                "adapterId": "blender",
                "instanceId": self._instance_id,
                "decision": decision,
                "occurredAt": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            }
        )

    def submit_proposal_decision(self, payload: dict[str, Any]) -> None:
        """Queue an already-identified decision without changing its identity."""
        proposal_id = payload.get("proposalId")
        decision_id = payload.get("decisionId")
        decision = payload.get("decision")
        self._validated_optional_uuid(proposal_id, "Proposal id")
        self._validated_optional_uuid(decision_id, "Proposal decision id")
        if decision not in {"accepted", "rejected"}:
            raise ValueError("Proposal decision must be accepted or rejected")
        self.control.put({"kind": "proposal_seen", "proposalId": proposal_id})
        self.decisions.put(dict(payload))

    def quarantine_proposal(self, proposal_id: str) -> None:
        """Suppress redelivery of an invalid proposal without inventing a decision."""
        self._validated_optional_uuid(proposal_id, "Proposal id")
        self.control.put({"kind": "proposal_seen", "proposalId": proposal_id})

    def _request_json(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        abort_on_stop: bool = False,
    ) -> dict[str, Any]:
        if not path.startswith("/"):
            raise ValueError("Runtime request path must be absolute")
        data = None
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
            "Connection": "close",
        }
        if (
            path.startswith("/api/v1/companion/guide?")
            or path.startswith("/api/v1/companion/action?")
            or path.startswith("/api/v1/companion/leaf-operation?")
            or path.startswith("/api/v1/companion/leaf-operation-recovery?")
            or path.startswith("/api/v1/companion/poke-compound?")
            or path.startswith("/api/v1/companion/poke-compound-recovery?")
            or path == "/api/v1/companion/state"
            or path == "/api/v1/companion/proposal-decision"
            or path == "/api/v1/companion/action-result"
            or path == "/api/v1/companion/leaf-operation-result"
            or path == "/api/v1/companion/leaf-operation-recovery"
            or path == "/api/v1/companion/poke-compound-result"
            or path == "/api/v1/companion/poke-compound-recovery"
            or path == "/api/v1/companion/execution-track-preflight"
            or path.startswith("/api/v1/companion/execution-track-preflight?")
            or path == "/api/v1/companion/execution-track-preflight/poll"
            or path.startswith("/api/v1/companion/execution-track-preflight/poll?")
            or path == "/api/v1/companion/execution-track-preflight/result"
            or path.startswith("/api/v1/companion/execution-track-execution?")
            or path == "/api/v1/companion/execution-track-execution/progress"
            or path == "/api/v1/companion/execution-track-execution/managed-start"
            or path == "/api/v1/companion/execution-track-execution/result"
            or path.startswith("/api/v1/companion/execution-track-execution/recovery?")
            or path == "/api/v1/companion/execution-track-execution/recovery"
            or path.startswith("/api/v1/companion/shortcut-proof?")
            or path == "/api/v1/companion/shortcut-proof-progress"
            or path == "/api/v1/companion/shortcut-proof-result"
            or path == "/api/v1/companion/shortcut-proof-recovery"
            or path.startswith("/api/v1/companion/menu-control-proof?")
            or path == "/api/v1/companion/menu-control-proof-progress"
            or path == "/api/v1/companion/menu-control-proof-result"
            or path == "/api/v1/companion/menu-control-proof-history-transition"
            or path == "/api/v1/companion/menu-control-proof-recovery"
        ):
            session = self._session_snapshot
            if session is None:
                raise ValueError("Companion session is not established")
            headers["x-operatingline-companion-lease"] = session.lease_id
        if payload is not None:
            data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request_path = f"{self._base_path}{path}"
        connection = HTTPConnection(self._host, self._port, timeout=self._timeout)
        with self._connection_lock:
            self._active_connection = connection
        deadline = threading.Timer(
            self._timeout, lambda: self._abort_connection(connection)
        )
        deadline.daemon = True
        deadline.start()
        try:
            connection.request(method, request_path, body=data, headers=headers)
            with self._connection_lock:
                if self._active_connection is connection:
                    # HTTPConnection may clear ``sock`` as soon as a
                    # Connection: close response is parsed. Retain the exact
                    # socket so stop() can still interrupt a blocked body read.
                    self._active_socket = connection.sock
            if abort_on_stop and self._stop.is_set():
                self._abort_connection(connection)
            response = connection.getresponse()
            body = self._read_response_body(
                response,
                abort_on_stop=abort_on_stop,
            )
            if len(body) > MAX_RESPONSE_BYTES:
                raise ValueError("Runtime response exceeds 4 MiB limit")
            if not 200 <= response.status < 300:
                http_error = HTTPError(
                    f"{self.base_url}{path}",
                    response.status,
                    response.reason,
                    response.headers,
                    None,
                )
                try:
                    error_payload = json.loads(body.decode("utf-8")) if body else {}
                except (UnicodeDecodeError, json.JSONDecodeError):
                    error_payload = {}
                if isinstance(error_payload, dict):
                    http_error.runtime_payload = error_payload
                raise http_error
        finally:
            deadline.cancel()
            connection.close()
            with self._connection_lock:
                if self._active_connection is connection:
                    self._active_connection = None
                    self._active_socket = None
        decoded = json.loads(body.decode("utf-8")) if body else {}
        if not isinstance(decoded, dict):
            raise ValueError("Runtime response must be a JSON object")
        return decoded

    @staticmethod
    def _validate_exact_keys(
        payload: dict[str, Any], expected: set[str], label: str
    ) -> None:
        actual = set(payload)
        if actual != expected:
            missing = sorted(expected - actual)
            unexpected = sorted(actual - expected)
            details = []
            if missing:
                details.append(f"missing {', '.join(missing)}")
            if unexpected:
                details.append(f"unexpected {', '.join(unexpected)}")
            raise ValueError(f"{label} has invalid fields: {'; '.join(details)}")

    @staticmethod
    def _validate_expiry(value: Any, label: str) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{label} must be an ISO-8601 timestamp")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError(f"{label} must be an ISO-8601 timestamp") from error
        if parsed.tzinfo is None:
            raise ValueError(f"{label} must include a timezone")
        return value

    def _establish_session(self) -> None:
        response = self._request_json(
            "POST",
            "/api/v1/companion/session",
            {
                "contractVersion": COMPANION_SESSION_CONTRACT_VERSION,
                "adapterId": "blender",
                "instanceId": self._instance_id,
                "sessionId": self._session_id,
                "documentIncarnationId": self._document_incarnation_id,
                "companionVersion": self._companion_version,
                "hostVersion": self._host_version,
                "supportedGuideProtocolVersions": sorted(SUPPORTED_PROTOCOL_VERSIONS),
                "catalogVersion": BLENDER_ACTION_CATALOG_VERSION,
                "capabilities": BLENDER_ADAPTER_CAPABILITIES,
            },
        )
        self._validate_exact_keys(
            response,
            {
                "contractVersion",
                "leaseId",
                "negotiatedGuideProtocolVersion",
                "catalogVersion",
                "capabilities",
                "heartbeatIntervalMs",
                "leaseTtlMs",
                "expiresAt",
                "sessionId",
                "documentIncarnationId",
            },
            "Companion session response",
        )
        if response["contractVersion"] != COMPANION_SESSION_CONTRACT_VERSION:
            raise ValueError("Unsupported companion session contract version")
        if response["sessionId"] != self._session_id:
            raise ValueError("Runtime echoed the wrong companion session id")
        if response["documentIncarnationId"] != self._document_incarnation_id:
            raise ValueError("Runtime echoed the wrong document incarnation id")
        lease_id = self._validated_optional_uuid(
            response["leaseId"], "Companion lease id"
        )
        if lease_id is None:
            raise ValueError("Companion lease id must be a UUID")
        negotiated_version = response["negotiatedGuideProtocolVersion"]
        if negotiated_version not in SUPPORTED_PROTOCOL_VERSIONS:
            raise ValueError("Runtime negotiated an unsupported guide protocol version")
        if response["catalogVersion"] != BLENDER_ACTION_CATALOG_VERSION:
            raise ValueError("Runtime negotiated the wrong Blender action catalog")
        if response["capabilities"] != BLENDER_ADAPTER_CAPABILITIES:
            raise ValueError("Runtime negotiated unexpected Blender capabilities")
        heartbeat_interval_ms = response["heartbeatIntervalMs"]
        lease_ttl_ms = response["leaseTtlMs"]
        if (
            isinstance(heartbeat_interval_ms, bool)
            or not isinstance(heartbeat_interval_ms, int)
            or heartbeat_interval_ms <= 0
        ):
            raise ValueError("Heartbeat interval must be a positive integer")
        if (
            isinstance(lease_ttl_ms, bool)
            or not isinstance(lease_ttl_ms, int)
            or lease_ttl_ms <= heartbeat_interval_ms
        ):
            raise ValueError("Lease TTL must be longer than the heartbeat interval")
        expires_at = self._validate_expiry(response["expiresAt"], "Lease expiry")
        heartbeat_interval_seconds = heartbeat_interval_ms / 1000.0
        self._session_snapshot = CompanionSessionSnapshot(
            lease_id=lease_id,
            session_id=self._session_id,
            document_incarnation_id=self._document_incarnation_id,
            negotiated_guide_protocol_version=negotiated_version,
            heartbeat_interval_seconds=heartbeat_interval_seconds,
            expires_at=expires_at,
            next_heartbeat_at=time.monotonic() + heartbeat_interval_seconds,
            heartbeat_sequence=0,
        )
        self._menu_control_recovery_barrier_lease_id = lease_id
        self.incoming.put(
            {
                "kind": "session_established",
                "leaseId": lease_id,
                "negotiatedGuideProtocolVersion": negotiated_version,
                "expiresAt": expires_at,
                "sessionId": self._session_id,
                "documentIncarnationId": self._document_incarnation_id,
            }
        )

    def _send_heartbeat(self) -> None:
        session = self._session_snapshot
        if session is None:
            raise ValueError("Companion session is not established")
        sequence = session.heartbeat_sequence + 1
        response = self._request_json(
            "POST",
            "/api/v1/companion/heartbeat",
            {
                "contractVersion": COMPANION_SESSION_CONTRACT_VERSION,
                "leaseId": session.lease_id,
                "adapterId": "blender",
                "instanceId": self._instance_id,
                "sessionId": session.session_id,
                "documentIncarnationId": session.document_incarnation_id,
                "sequence": sequence,
            },
            abort_on_stop=True,
        )
        self._validate_exact_keys(
            response,
            {
                "contractVersion",
                "leaseId",
                "sequence",
                "expiresAt",
                "sessionId",
                "documentIncarnationId",
            },
            "Companion heartbeat response",
        )
        if response["contractVersion"] != COMPANION_SESSION_CONTRACT_VERSION:
            raise ValueError("Unsupported companion heartbeat contract version")
        if response["leaseId"] != session.lease_id:
            raise ValueError("Runtime acknowledged the wrong companion lease")
        if response["sessionId"] != session.session_id:
            raise ValueError("Runtime acknowledged the wrong companion session id")
        if response["documentIncarnationId"] != session.document_incarnation_id:
            raise ValueError("Runtime acknowledged the wrong document incarnation id")
        if response["sequence"] != sequence:
            raise ValueError("Runtime acknowledged the wrong heartbeat sequence")
        expires_at = self._validate_expiry(response["expiresAt"], "Lease expiry")
        if self._session_snapshot is session:
            self._session_snapshot = replace(
                session,
                expires_at=expires_at,
                next_heartbeat_at=(
                    time.monotonic() + session.heartbeat_interval_seconds
                ),
                heartbeat_sequence=sequence,
            )

    def _service_lease_refresh_requests(self) -> bool:
        """Service all explicit lease refreshes on the network-owning thread."""

        serviced = False
        while True:
            try:
                request = self._lease_refresh_requests.get_nowait()
            except Empty:
                return serviced
            serviced = True
            try:
                session = self._session_snapshot
                if session is None:
                    raise RuntimeError("Companion session disappeared before lease refresh")
                if self._lease_validity_seconds(session) < request.minimum_validity_seconds:
                    self._send_heartbeat()
                    session = self._session_snapshot
                if session is None:
                    raise RuntimeError("Companion session disappeared during lease refresh")
                if self._lease_validity_seconds(session) < request.minimum_validity_seconds:
                    raise RuntimeError(
                        "Companion heartbeat did not provide enough lease validity"
                    )
                request.lease = self.current_document_lease
            except (HTTPError, HTTPException, OSError, RuntimeError, ValueError) as error:
                request.error = str(error)
            finally:
                request.completed.set()

    def _clear_session(self) -> None:
        self._session_snapshot = None

    def _release_menu_control_recovery_barrier(self, lease_id: str) -> None:
        if self._menu_control_recovery_barrier_lease_id == lease_id:
            self._menu_control_recovery_barrier_lease_id = None

    def _read_response_body(
        self,
        response: HTTPResponse,
        *,
        abort_on_stop: bool,
    ) -> bytes:
        body = bytearray()
        while len(body) <= MAX_RESPONSE_BYTES:
            if abort_on_stop and self._stop.is_set():
                raise OSError("Companion transport stopped")
            remaining = MAX_RESPONSE_BYTES + 1 - len(body)
            chunk = response.read1(min(64 * 1024, remaining))
            if not chunk:
                break
            body.extend(chunk)
        return bytes(body)

    def _close_active_connection(self) -> None:
        with self._connection_lock:
            connection = self._active_connection
        if connection is not None:
            self._abort_connection(connection)

    def _abort_connection(self, connection: HTTPConnection) -> None:
        with self._connection_lock:
            if self._active_connection is not connection:
                return
            sock = self._active_socket or connection.sock
        if sock is not None:
            try:
                sock.shutdown(2)
            except OSError:
                pass
            sock.close()

    def _poll(self) -> None:
        session = self._session_snapshot
        if session is None:
            raise ValueError("Companion session is not established")
        query: dict[str, str] = {
            "adapterId": "blender",
            "instanceId": self._instance_id,
        }
        if self._known_plan_id is not None:
            query["knownPlanId"] = self._known_plan_id
        if self._known_revision is not None:
            query["knownRevision"] = str(self._known_revision)
        if self._known_plan_content_sha256 is not None:
            query["knownPlanContentSha256"] = self._known_plan_content_sha256
        if self._known_proposal_id is not None:
            query["knownProposalId"] = self._known_proposal_id
        response = self._request_json(
            "GET",
            f"/api/v1/companion/guide?{urlencode(query)}",
            abort_on_stop=True,
        )
        if (
            response.get("protocolVersion")
            != session.negotiated_guide_protocol_version
        ):
            raise ValueError("Unsupported companion protocol version")
        if "planContentSha256" not in response:
            raise ValueError("Runtime delivery must contain planContentSha256")
        plan = response.get("plan")
        plan_content_sha256 = self._validated_delivery_hash(
            response.get("planContentSha256"),
            present=plan is not None,
            label="Runtime plan content SHA-256",
        )
        if plan is not None and not isinstance(plan, dict):
            raise ValueError("Runtime plan must be an object or null")
        if "proposalPlanContentSha256" not in response:
            raise ValueError("Runtime delivery must contain proposalPlanContentSha256")
        proposal = response.get("proposal")
        proposal_plan_content_sha256 = self._validated_delivery_hash(
            response.get("proposalPlanContentSha256"),
            present=proposal is not None,
            label="Runtime proposal plan content SHA-256",
        )
        if proposal is not None:
            if not isinstance(proposal, dict):
                raise ValueError("Runtime proposal must be an object or null")
            proposal_id = proposal.get("proposalId")
            if not isinstance(proposal_id, str) or not proposal_id:
                raise ValueError("Runtime proposal must contain a proposalId")
            self._known_proposal_id = proposal_id
            revision_thread = proposal.get("revisionThread")
            if isinstance(revision_thread, dict):
                thread_id = revision_thread.get("threadId")
                if isinstance(thread_id, str):
                    self._revision_thread_id = self._validated_optional_uuid(
                        thread_id,
                        "Proposal revision thread id",
                    )
                    self._revision_history_signature = None
        replay_current_state_request = self._validated_replay_current_state_request(
            response.get("procedureReplayCurrentStateRequest")
        )
        if plan is not None:
            self.incoming.put(
                {
                    "kind": "plan",
                    "plan": plan,
                    "planContentSha256": plan_content_sha256,
                }
            )
        if proposal is not None:
            self.incoming.put(
                {
                    "kind": "proposal",
                    "proposal": proposal,
                    "proposalPlanContentSha256": proposal_plan_content_sha256,
                }
            )
        if replay_current_state_request is not None:
            verification_id = replay_current_state_request["verificationId"]
            if verification_id not in self._seen_replay_current_state_verification_ids:
                if len(self._seen_replay_current_state_verification_ids) >= 256:
                    self._seen_replay_current_state_verification_ids.pop()
                self._seen_replay_current_state_verification_ids.add(verification_id)
                self.incoming.put(
                    {
                        "kind": "procedure_replay_current_state_request",
                        "request": replay_current_state_request,
                    }
                )
        self._poll_revision_history()
        self._poll_revision_branches()
        if session.negotiated_guide_protocol_version in NATIVE_UNDO_PROTOCOL_VERSIONS:
            poke_recovery_pending = self._poll_poke_compound_recovery_request()
            if not poke_recovery_pending:
                self._poll_poke_compound_request()
                leaf_recovery_pending = self._poll_leaf_operation_recovery_request()
                if not leaf_recovery_pending:
                    self._poll_action_request()
                    self._poll_leaf_operation_request()
            self._poll_menu_control_proof_request()
            self._poll_shortcut_proof_request()
        if (
            session.negotiated_guide_protocol_version in EXECUTION_TRACK_PROTOCOL_VERSIONS
            and self._execution_track_preflight_poll_enabled
        ):
            self._poll_execution_track_preflight()
        if session.negotiated_guide_protocol_version in EXECUTION_TRACK_PROTOCOL_VERSIONS:
            self._poll_execution_track_execution()
            if self._execution_track_execution_recovery_poll_enabled:
                self._poll_execution_track_execution_recovery()

    def _poll_execution_track_execution(self) -> None:
        response = self._request_json(
            "GET",
            "/api/v1/companion/execution-track-execution?"
            + urlencode({"adapterId": "blender", "instanceId": self._instance_id}),
            abort_on_stop=True,
        )
        self._validate_exact_keys(response, {"request"}, "Execution-track execution poll")
        delivery = response["request"]
        if delivery is None:
            return
        if not isinstance(delivery, dict):
            raise ValueError("Execution-track execution delivery must be an object or null")
        binding = delivery.get("binding")
        request_id = binding.get("requestId") if isinstance(binding, dict) else None
        self._validated_required_uuid(request_id, "Execution-track execution request id")
        if (
            request_id in self._seen_execution_track_execution_request_ids
            or request_id in self._inflight_execution_track_execution_request_ids
        ):
            return
        self._inflight_execution_track_execution_request_ids.add(request_id)
        self.incoming.put(
            {"kind": "execution_track_execution_delivery", "request": deepcopy(delivery)}
        )

    def _poll_execution_track_execution_recovery(self) -> None:
        response = self._request_json(
            "GET",
            "/api/v1/companion/execution-track-execution/recovery?"
            + urlencode({"adapterId": "blender", "instanceId": self._instance_id}),
            abort_on_stop=True,
        )
        self._validate_exact_keys(response, {"request"}, "Execution-track recovery poll")
        request = response["request"]
        if request is None:
            return
        if not isinstance(request, dict):
            raise ValueError("Execution-track recovery request must be an object or null")
        self.incoming.put(
            {"kind": "execution_track_execution_recovery_request", "request": deepcopy(request)}
        )

    def _poll_execution_track_preflight(self) -> None:
        response = self._request_json(
            "GET",
            "/api/v1/companion/execution-track-preflight/poll?"
            + urlencode({"adapterId": "blender", "instanceId": self._instance_id}),
            abort_on_stop=True,
        )
        self._validate_exact_keys(
            response, {"request"}, "Execution-track preflight poll"
        )
        delivery = response["request"]
        if delivery is None:
            return
        if not isinstance(delivery, dict):
            raise ValueError("Execution-track preflight delivery must be an object")
        binding = delivery.get("binding")
        request_id = binding.get("requestId") if isinstance(binding, dict) else None
        self._validated_required_uuid(
            request_id, "Execution-track preflight request id"
        )
        if request_id in self._seen_execution_track_preflight_request_ids:
            return
        if len(self._seen_execution_track_preflight_request_ids) >= 256:
            self._seen_execution_track_preflight_request_ids.pop()
        self._seen_execution_track_preflight_request_ids.add(request_id)
        self.incoming.put(
            {"kind": "execution_track_preflight_delivery", "request": deepcopy(delivery)}
        )

    @staticmethod
    def _validated_required_uuid(value: Any, label: str) -> str:
        validated = CompanionTransport._validated_optional_uuid(value, label)
        if validated is None:
            raise ValueError(f"{label} must be a UUID")
        return validated

    @staticmethod
    def _validate_action_step(step: Any) -> None:
        if not isinstance(step, dict):
            raise ValueError("Action execution step must be an object")
        required = {
            "id",
            "parentId",
            "order",
            "dependsOn",
            "title",
            "intent",
            "explanation",
            "state",
            "action",
            "anchors",
            "expectedObservations",
            "rollback",
        }
        allowed = required | {"observationPolicy", "candidateMenuProjection"}
        actual = set(step)
        if not required.issubset(actual) or not actual.issubset(allowed):
            CompanionTransport._validate_exact_keys(step, required, "Action execution step")
        if not isinstance(step["id"], str) or not step["id"]:
            raise ValueError("Action execution step id must be non-empty text")
        if step["parentId"] is not None and not isinstance(step["parentId"], str):
            raise ValueError("Action execution step parent id must be text or null")
        if (
            isinstance(step["order"], bool)
            or not isinstance(step["order"], int)
            or step["order"] < 0
        ):
            raise ValueError("Action execution step order must be a non-negative integer")
        if not isinstance(step["dependsOn"], list) or not all(
            isinstance(item, str) and item for item in step["dependsOn"]
        ):
            raise ValueError("Action execution step dependencies must be step ids")
        for field in ("title", "intent", "explanation", "state"):
            if not isinstance(step[field], str) or not step[field]:
                raise ValueError(f"Action execution step {field} must be non-empty text")
        if not isinstance(step["anchors"], list):
            raise ValueError("Action execution anchors must be an array")
        if not isinstance(step["expectedObservations"], list):
            raise ValueError("Action execution observations must be an array")
        action = step["action"]
        if not isinstance(action, dict):
            raise ValueError("Action execution step must contain an action")
        CompanionTransport._validate_exact_keys(
            action, {"adapterId", "name", "arguments"}, "Action execution binding"
        )
        if action["adapterId"] != "blender" or not is_action_level_mcp_action(
            action["name"]
        ):
            raise ValueError(
                "Action execution is restricted to the exact approved action-level MCP allowlist"
            )
        if not isinstance(action["arguments"], dict):
            raise ValueError("Action execution arguments must be an object")
        rollback = step["rollback"]
        if not isinstance(rollback, dict):
            raise ValueError("Action execution rollback must be an object")
        CompanionTransport._validate_exact_keys(
            rollback, {"mode", "checkpointRequired"}, "Action execution rollback"
        )
        if not isinstance(rollback["mode"], str) or not isinstance(
            rollback["checkpointRequired"], bool
        ):
            raise ValueError("Action execution rollback has invalid values")
        if "observationPolicy" in step and not isinstance(
            step["observationPolicy"], dict
        ):
            raise ValueError("Action execution observation policy must be an object")
        if "candidateMenuProjection" in step:
            validate_candidate_menu_projection_data(step["candidateMenuProjection"])

    def _validate_action_delivery(self, delivery: Any) -> dict[str, Any]:
        if not isinstance(delivery, dict):
            raise ValueError("Action execution delivery must be an object")
        self._validate_exact_keys(
            delivery,
            {
                "formatVersion",
                "requestId",
                "replayId",
                "deliveryId",
                "target",
                "proposalId",
                "plan",
                "planContentSha256",
                "executionId",
                "expectedState",
                "step",
                "requestedAt",
                "dispatchedAt",
            },
            "Action execution delivery",
        )
        if delivery["formatVersion"] != "1.0.0":
            raise ValueError("Unsupported action execution format version")
        for field in (
            "requestId",
            "replayId",
            "deliveryId",
            "proposalId",
            "executionId",
        ):
            self._validated_required_uuid(delivery[field], f"Action execution {field}")
        target = delivery["target"]
        if not isinstance(target, dict):
            raise ValueError("Action execution target must be an object")
        self._validate_exact_keys(
            target, {"adapterId", "instanceId"}, "Action execution target"
        )
        if target["adapterId"] != "blender" or target["instanceId"] != self._instance_id:
            raise ValueError("Action execution targets a different Blender instance")
        self._validated_required_uuid(target["instanceId"], "Action execution instance id")
        plan = delivery["plan"]
        if not isinstance(plan, dict):
            raise ValueError("Action execution plan must be an object")
        self._validate_exact_keys(plan, {"id", "revision"}, "Action execution plan")
        if not isinstance(plan["id"], str) or not plan["id"]:
            raise ValueError("Action execution plan id must be non-empty text")
        if (
            isinstance(plan["revision"], bool)
            or not isinstance(plan["revision"], int)
            or plan["revision"] <= 0
        ):
            raise ValueError("Action execution plan revision must be positive")
        if (
            not isinstance(delivery["planContentSha256"], str)
            or CONTENT_SHA256_PATTERN.fullmatch(delivery["planContentSha256"]) is None
        ):
            raise ValueError("Action execution plan content SHA-256 is invalid")
        expected_state = delivery["expectedState"]
        if not isinstance(expected_state, dict):
            raise ValueError("Action execution expected state must be an object")
        self._validate_exact_keys(
            expected_state, {"reportId", "sequence"}, "Action execution expected state"
        )
        self._validated_required_uuid(
            expected_state["reportId"], "Action execution expected report id"
        )
        if (
            isinstance(expected_state["sequence"], bool)
            or not isinstance(expected_state["sequence"], int)
            or expected_state["sequence"] <= 0
        ):
            raise ValueError("Action execution expected sequence must be positive")
        self._validate_action_step(delivery["step"])
        self._validate_expiry(delivery["requestedAt"], "Action execution requested time")
        self._validate_expiry(delivery["dispatchedAt"], "Action execution dispatched time")
        return delivery

    def _poll_action_request(self) -> None:
        response = self._request_json(
            "GET",
            "/api/v1/companion/action?"
            + urlencode({"adapterId": "blender", "instanceId": self._instance_id}),
            abort_on_stop=True,
        )
        self._validate_exact_keys(response, {"request"}, "Action execution poll")
        delivery = response["request"]
        if delivery is None:
            return
        validated = self._validate_action_delivery(delivery)
        request_id = validated["requestId"]
        if request_id in self._seen_action_request_ids:
            return
        if len(self._seen_action_request_ids) >= 256:
            self._seen_action_request_ids.pop()
        self._seen_action_request_ids.add(request_id)
        self.incoming.put(
            {"kind": "action_execute_request", "request": dict(validated)}
        )

    def _validate_leaf_operation_delivery(self, delivery: Any) -> dict[str, Any]:
        if not isinstance(delivery, dict):
            raise ValueError("Leaf-operation delivery must be an object")
        expected_keys = set(LEAF_OPERATION_AUTHORITY_KEYS) | {
            "operationBindingSha256",
            "deliveryId",
            "requestedAt",
            "dispatchedAt",
        }
        self._validate_exact_keys(
            delivery, expected_keys, "Leaf-operation delivery"
        )
        if delivery["formatVersion"] != "1.0.0":
            raise ValueError("Unsupported leaf-operation format version")
        for field in (
            "requestId",
            "replayId",
            "proposalId",
            "executionId",
            "deliveryId",
        ):
            self._validated_required_uuid(
                delivery[field], f"Leaf-operation {field}"
            )
        target = delivery["target"]
        if not isinstance(target, dict):
            raise ValueError("Leaf-operation target must be an object")
        self._validate_exact_keys(
            target, {"adapterId", "instanceId"}, "Leaf-operation target"
        )
        if target != {"adapterId": "blender", "instanceId": self._instance_id}:
            raise ValueError("Leaf-operation targets a different Blender instance")
        self._validated_required_uuid(target["instanceId"], "Leaf-operation instance id")
        plan = delivery["plan"]
        if not isinstance(plan, dict):
            raise ValueError("Leaf-operation plan must be an object")
        self._validate_exact_keys(plan, {"id", "revision"}, "Leaf-operation plan")
        if not isinstance(plan["id"], str) or not plan["id"]:
            raise ValueError("Leaf-operation plan id must be non-empty text")
        if (
            isinstance(plan["revision"], bool)
            or not isinstance(plan["revision"], int)
            or plan["revision"] <= 0
        ):
            raise ValueError("Leaf-operation plan revision must be positive")
        for field in (
            "planContentSha256",
            "interactionCatalogContentSha256",
            "materializationContentSha256",
            "mcpTrackContentSha256",
            "operationBindingSha256",
        ):
            if (
                not isinstance(delivery[field], str)
                or CONTENT_SHA256_PATTERN.fullmatch(delivery[field]) is None
            ):
                raise ValueError(f"Leaf-operation {field} is invalid")
        expected_state = delivery["expectedState"]
        if not isinstance(expected_state, dict):
            raise ValueError("Leaf-operation expected state must be an object")
        self._validate_exact_keys(
            expected_state, {"reportId", "sequence"}, "Leaf-operation expected state"
        )
        self._validated_required_uuid(
            expected_state["reportId"], "Leaf-operation expected report id"
        )
        if (
            isinstance(expected_state["sequence"], bool)
            or not isinstance(expected_state["sequence"], int)
            or expected_state["sequence"] <= 0
        ):
            raise ValueError("Leaf-operation expected sequence must be positive")
        if delivery["leafId"] != delivery["stepId"] or not isinstance(
            delivery["leafId"], str
        ) or not delivery["leafId"]:
            raise ValueError("Leaf-operation leaf and step ids must be the same non-empty id")
        profile = GUIDED_GEOMETRY_LEAF_OPERATION_PROFILES.get(
            delivery["actionName"]
        )
        if profile is None:
            raise ValueError("Leaf-operation action is not a fixed guided profile")
        recipe_id, operation_ids, _parameter_names, _tool_name = profile
        if delivery["recipeId"] != recipe_id:
            raise ValueError("Leaf-operation recipe does not match its fixed action profile")
        if (
            not isinstance(delivery["catalogVersion"], str)
            or re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", delivery["catalogVersion"])
            is None
        ):
            raise ValueError("Leaf-operation catalog version is invalid")
        if delivery["operationIds"] != list(operation_ids):
            raise ValueError("Leaf-operation ids are not the fixed action sequence")
        ordinal = delivery["operationOrdinal"]
        if (
            isinstance(ordinal, bool)
            or not isinstance(ordinal, int)
            or not 1 <= ordinal <= len(operation_ids)
        ):
            raise ValueError(
                f"Leaf-operation ordinal must be between 1 and {len(operation_ids)}"
            )
        if delivery["sourceOperationId"] != operation_ids[ordinal - 1]:
            raise ValueError("Leaf-operation id does not match its ordinal")
        if not isinstance(delivery["operationParameters"], dict) or not all(
            isinstance(key, str) and key for key in delivery["operationParameters"]
        ):
            raise ValueError("Leaf-operation parameters must be a string-keyed object")
        authority = {key: deepcopy(delivery[key]) for key in LEAF_OPERATION_AUTHORITY_KEYS}
        if delivery["operationBindingSha256"] != self._canonical_sha256(authority):
            raise ValueError("Leaf-operation immutable binding hash changed")
        self._validate_expiry(delivery["requestedAt"], "Leaf-operation requested time")
        self._validate_expiry(delivery["dispatchedAt"], "Leaf-operation dispatched time")
        if datetime.fromisoformat(delivery["requestedAt"].replace("Z", "+00:00")) > datetime.fromisoformat(
            delivery["dispatchedAt"].replace("Z", "+00:00")
        ):
            raise ValueError("Leaf-operation was dispatched before it was requested")
        return deepcopy(delivery)

    def _poll_leaf_operation_request(self) -> None:
        response = self._request_json(
            "GET",
            "/api/v1/companion/leaf-operation?"
            + urlencode({"adapterId": "blender", "instanceId": self._instance_id}),
            abort_on_stop=True,
        )
        self._validate_exact_keys(response, {"request"}, "Leaf-operation poll")
        delivery = response["request"]
        if delivery is None:
            return
        validated = self._validate_leaf_operation_delivery(delivery)
        request_id = validated["requestId"]
        if request_id in self._seen_leaf_operation_request_ids:
            return
        if len(self._seen_leaf_operation_request_ids) >= 256:
            self._seen_leaf_operation_request_ids.pop()
        self._seen_leaf_operation_request_ids.add(request_id)
        self.incoming.put(
            {"kind": "leaf_operation_execute_request", "request": validated}
        )

    def _validate_poke_compound_delivery(self, delivery: Any) -> dict[str, Any]:
        if not isinstance(delivery, dict):
            raise ValueError("Poke compound delivery must be an object")
        expected_keys = {
            "formatVersion",
            "requestId",
            "deliveryId",
            "deliveryContentSha256",
            "target",
            "replayId",
            "compoundId",
            "compoundContentSha256",
            "historyLockTokenSha256",
            "replay",
            "decisionReceipt",
            "trustedDecisionConsumptionEvent",
            "requestedAt",
            "dispatchedAt",
        }
        self._validate_exact_keys(delivery, expected_keys, "Poke compound delivery")
        if delivery["formatVersion"] != "1.0.0":
            raise ValueError("Unsupported Poke compound format version")
        for field in ("requestId", "deliveryId", "replayId", "compoundId"):
            self._validated_required_uuid(delivery[field], f"Poke compound {field}")
        for field in (
            "deliveryContentSha256",
            "compoundContentSha256",
            "historyLockTokenSha256",
        ):
            if (
                not isinstance(delivery[field], str)
                or CONTENT_SHA256_PATTERN.fullmatch(delivery[field]) is None
            ):
                raise ValueError(f"Poke compound {field} is invalid")
        target = delivery["target"]
        if not isinstance(target, dict):
            raise ValueError("Poke compound target must be an object")
        self._validate_exact_keys(target, {"adapterId", "instanceId"}, "Poke compound target")
        if target != {"adapterId": "blender", "instanceId": self._instance_id}:
            raise ValueError("Poke compound targets a different Blender instance")
        replay = delivery["replay"]
        if not isinstance(replay, dict):
            raise ValueError("Poke compound replay must be an object")
        self._validate_exact_keys(
            replay,
            {
                "formatVersion",
                "planContentSha256",
                "target",
                "actionCatalogVersion",
                "interactionCatalogVersion",
                "recipe",
                "currentState",
                "leafProgress",
            },
            "Poke compound replay",
        )
        recipe = replay["recipe"]
        current_state = replay["currentState"]
        if not isinstance(recipe, dict) or not isinstance(current_state, dict):
            raise ValueError("Poke compound recipe and current state must be objects")
        identity_pairs = (
            (replay["target"], target, "target"),
            (recipe.get("replayId"), delivery["replayId"], "replay id"),
            (recipe.get("compoundId"), delivery["compoundId"], "compound id"),
            (
                recipe.get("compoundContentSha256"),
                delivery["compoundContentSha256"],
                "compound content",
            ),
            (
                recipe.get("historyLockTokenSha256"),
                delivery["historyLockTokenSha256"],
                "history lock",
            ),
            (current_state.get("replayId"), delivery["replayId"], "current replay id"),
            (current_state.get("compoundId"), delivery["compoundId"], "current compound id"),
        )
        if any(actual != expected for actual, expected, _label in identity_pairs):
            changed = next(
                label for actual, expected, label in identity_pairs if actual != expected
            )
            raise ValueError(f"Poke compound delivery changed its {changed}")
        leaf_progress = replay["leafProgress"]
        if (
            not isinstance(leaf_progress, list)
            or len(leaf_progress) != 3
            or any(
                not isinstance(progress, dict)
                or progress.get("intentSha256") is not None
                or progress.get("receiptSha256") is not None
                for progress in leaf_progress
            )
        ):
            raise ValueError("Poke compound delivery must start before every leaf intent")
        decision = delivery["decisionReceipt"]
        consumption = delivery["trustedDecisionConsumptionEvent"]
        if not isinstance(decision, dict) or not isinstance(consumption, dict):
            raise ValueError("Poke compound decision evidence must be objects")
        if (
            decision.get("replayId") != delivery["replayId"]
            or decision.get("target") != target
            or consumption.get("credentialId") != decision.get("decisionId")
        ):
            raise ValueError("Poke compound decision evidence changed its replay authority")
        requested_at = self._validate_expiry(
            delivery["requestedAt"], "Poke compound requested time"
        )
        dispatched_at = self._validate_expiry(
            delivery["dispatchedAt"], "Poke compound dispatched time"
        )
        if datetime.fromisoformat(requested_at.replace("Z", "+00:00")) > datetime.fromisoformat(
            dispatched_at.replace("Z", "+00:00")
        ):
            raise ValueError("Poke compound was dispatched before it was requested")
        content = {key: deepcopy(delivery[key]) for key in expected_keys - {"deliveryContentSha256"}}
        if delivery["deliveryContentSha256"] != self._canonical_sha256(content):
            raise ValueError("Poke compound immutable delivery content changed")
        return deepcopy(delivery)

    def _poll_poke_compound_request(self) -> None:
        response = self._request_json(
            "GET",
            "/api/v1/companion/poke-compound?"
            + urlencode({"adapterId": "blender", "instanceId": self._instance_id}),
            abort_on_stop=True,
        )
        self._validate_exact_keys(response, {"request"}, "Poke compound poll")
        delivery = response["request"]
        if delivery is None:
            return
        validated = self._validate_poke_compound_delivery(delivery)
        request_id = validated["requestId"]
        if request_id in self._seen_poke_compound_request_ids:
            return
        if len(self._seen_poke_compound_request_ids) >= 256:
            self._seen_poke_compound_request_ids.pop()
        self._seen_poke_compound_request_ids.add(request_id)
        self.incoming.put({"kind": "poke_compound_execute_request", "request": validated})

    def _validate_poke_compound_recovery_challenge(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("Poke compound recovery challenge must be an object")
        self._validate_exact_keys(
            value,
            {
                "formatVersion",
                "recoveryId",
                "originalDelivery",
                "replacementSessionFingerprintSha256",
                "replacementDocumentAuthoritySha256",
                "requestedAt",
            },
            "Poke compound recovery challenge",
        )
        if value["formatVersion"] != "1.0.0":
            raise ValueError("Unsupported Poke compound recovery format version")
        self._validated_required_uuid(value["recoveryId"], "Poke compound recovery id")
        self._validate_poke_compound_delivery(value["originalDelivery"])
        for field in (
            "replacementSessionFingerprintSha256",
            "replacementDocumentAuthoritySha256",
        ):
            if (
                not isinstance(value[field], str)
                or CONTENT_SHA256_PATTERN.fullmatch(value[field]) is None
            ):
                raise ValueError(f"Poke compound recovery {field} is invalid")
        self._validate_expiry(value["requestedAt"], "Poke compound recovery requested time")
        return deepcopy(value)

    def _poll_poke_compound_recovery_request(self) -> bool:
        response = self._request_json(
            "GET",
            "/api/v1/companion/poke-compound-recovery?"
            + urlencode({"adapterId": "blender", "instanceId": self._instance_id}),
            abort_on_stop=True,
        )
        self._validate_exact_keys(response, {"request"}, "Poke compound recovery poll")
        challenge = response["request"]
        if challenge is None:
            return False
        validated = self._validate_poke_compound_recovery_challenge(challenge)
        recovery_id = validated["recoveryId"]
        if recovery_id not in self._seen_poke_compound_recovery_ids:
            if len(self._seen_poke_compound_recovery_ids) >= 256:
                self._seen_poke_compound_recovery_ids.pop()
            self._seen_poke_compound_recovery_ids.add(recovery_id)
            self.incoming.put(
                {"kind": "poke_compound_recovery_request", "request": validated}
            )
        return True

    @staticmethod
    def _validate_leaf_operation_recovery_sha256(value: Any, label: str) -> str:
        if not isinstance(value, str) or CONTENT_SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError(f"{label} must be 64 lowercase hex characters")
        return value

    def _validate_leaf_operation_recovery_prefix(
        self,
        value: Any,
        *,
        operation_ids: tuple[str, ...],
        ordinal: int,
    ) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("Leaf-operation recovery prefix must be an object")
        self._validate_exact_keys(
            value,
            {
                "completedOperationIds",
                "runId",
                "bindingSha256",
                "receiptId",
                "nextOrdinal",
                "latestFingerprintSha256",
            },
            "Leaf-operation recovery prefix",
        )
        expected_ids = list(operation_ids[: ordinal - 1])
        if value["completedOperationIds"] != expected_ids:
            raise ValueError("Leaf-operation recovery prefix is not the exact accepted prefix")
        if value["nextOrdinal"] != ordinal:
            raise ValueError("Leaf-operation recovery prefix has the wrong next ordinal")
        identity_fields = ("runId", "bindingSha256", "receiptId")
        if ordinal == 1:
            if any(value[field] is not None for field in identity_fields) or value[
                "latestFingerprintSha256"
            ] is not None:
                raise ValueError("An empty leaf-operation recovery prefix must have null identity")
        else:
            self._validated_required_uuid(value["runId"], "Leaf-operation recovery run id")
            self._validated_required_uuid(
                value["receiptId"], "Leaf-operation recovery receipt id"
            )
            self._validate_leaf_operation_recovery_sha256(
                value["bindingSha256"], "Leaf-operation recovery binding SHA-256"
            )
            self._validate_leaf_operation_recovery_sha256(
                value["latestFingerprintSha256"],
                "Leaf-operation recovery latest fingerprint SHA-256",
            )
        return deepcopy(value)

    def _validate_leaf_operation_recovery_checkpoint(
        self, value: Any
    ) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("Leaf-operation recovery checkpoint must be an object")
        self._validate_exact_keys(
            value,
            {
                "reportId",
                "sequence",
                "checkpointId",
                "previousCheckpointId",
                "operation",
                "sceneFingerprintSha256",
                "markerMatched",
                "sessionSnapshotMatches",
                "stageVerified",
                "observedAt",
            },
            "Leaf-operation recovery checkpoint",
        )
        self._validated_required_uuid(value["reportId"], "Recovery checkpoint report id")
        self._validated_required_uuid(
            value["checkpointId"], "Recovery checkpoint id"
        )
        if value["previousCheckpointId"] is not None:
            self._validated_required_uuid(
                value["previousCheckpointId"], "Recovery previous checkpoint id"
            )
        if (
            isinstance(value["sequence"], bool)
            or not isinstance(value["sequence"], int)
            or value["sequence"] <= 0
        ):
            raise ValueError("Recovery checkpoint sequence must be positive")
        if value["operation"] not in {
            "start",
            "next",
            "recheck",
            "back",
            "leaf_operation",
            "leaf_operation_failure",
        }:
            raise ValueError("Recovery checkpoint operation is unsupported")
        if value["sceneFingerprintSha256"] is not None:
            self._validate_leaf_operation_recovery_sha256(
                value["sceneFingerprintSha256"],
                "Recovery checkpoint scene fingerprint SHA-256",
            )
        for field in ("markerMatched", "sessionSnapshotMatches", "stageVerified"):
            if value[field] is not True:
                raise ValueError(f"Recovery checkpoint {field} must be true")
        self._validate_expiry(value["observedAt"], "Recovery checkpoint observed time")
        return deepcopy(value)

    def _validate_leaf_operation_recovery_challenge(
        self, value: Any
    ) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("Leaf-operation recovery challenge must be an object")
        self._validate_exact_keys(
            value,
            {
                "formatVersion",
                "recoveryId",
                "originalDelivery",
                "originalSessionFingerprintSha256",
                "replacementSessionFingerprintSha256",
                "expectedState",
                "acceptedPrefix",
                "authorityProof",
                "nativeUndoGuard",
                "mode",
                "automaticReplay",
                "requestedAt",
            },
            "Leaf-operation recovery challenge",
        )
        if value["formatVersion"] != "1.0.0":
            raise ValueError("Unsupported leaf-operation recovery format version")
        self._validated_required_uuid(value["recoveryId"], "Leaf-operation recovery id")
        delivery = self._validate_leaf_operation_delivery(value["originalDelivery"])
        original_fingerprint = self._validate_leaf_operation_recovery_sha256(
            value["originalSessionFingerprintSha256"],
            "Original recovery session fingerprint SHA-256",
        )
        replacement_fingerprint = self._validate_leaf_operation_recovery_sha256(
            value["replacementSessionFingerprintSha256"],
            "Replacement recovery session fingerprint SHA-256",
        )
        if original_fingerprint == replacement_fingerprint:
            raise ValueError("Leaf-operation recovery requires a replacement lease")
        expected_state = value["expectedState"]
        if expected_state != delivery["expectedState"]:
            raise ValueError("Leaf-operation recovery expected state changed")
        prefix = self._validate_leaf_operation_recovery_prefix(
            value["acceptedPrefix"],
            operation_ids=tuple(delivery["operationIds"]),
            ordinal=delivery["operationOrdinal"],
        )
        authority = value["authorityProof"]
        if not isinstance(authority, dict):
            raise ValueError("Leaf-operation recovery authority proof must be an object")
        self._validate_exact_keys(
            authority,
            {"reportId", "sequence", "authorizedStartCheckpointId"},
            "Leaf-operation recovery authority proof",
        )
        self._validated_required_uuid(
            authority["authorizedStartCheckpointId"],
            "Leaf-operation recovery authorized start checkpoint id",
        )
        if (
            authority["reportId"] != expected_state["reportId"]
            or authority["sequence"] != expected_state["sequence"]
        ):
            raise ValueError("Leaf-operation recovery authority proof changed")
        guard = value["nativeUndoGuard"]
        if guard is not None:
            if not isinstance(guard, dict):
                raise ValueError("Leaf-operation Native Undo guard must be an object or null")
            self._validate_exact_keys(
                guard,
                {"expectedRestoredCheckpointId", "recoveryTokenSha256"},
                "Leaf-operation Native Undo guard",
            )
            if guard["expectedRestoredCheckpointId"] is not None:
                self._validated_required_uuid(
                    guard["expectedRestoredCheckpointId"],
                    "Expected restored checkpoint id",
                )
            self._validate_leaf_operation_recovery_sha256(
                guard["recoveryTokenSha256"], "Native Undo recovery token SHA-256"
            )
        if value["mode"] != "read_only_reconcile" or value["automaticReplay"] is not False:
            raise ValueError("Leaf-operation recovery must be read-only without replay")
        requested_at = self._validate_expiry(
            value["requestedAt"], "Leaf-operation recovery requested time"
        )
        if datetime.fromisoformat(requested_at.replace("Z", "+00:00")) < datetime.fromisoformat(
            delivery["dispatchedAt"].replace("Z", "+00:00")
        ):
            raise ValueError("Leaf-operation recovery challenge predates delivery")
        validated = deepcopy(value)
        validated["originalDelivery"] = delivery
        validated["acceptedPrefix"] = prefix
        return validated

    def _validate_leaf_operation_succeeded_result(
        self, value: Any, delivery: dict[str, Any]
    ) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("Applied leaf-operation result must be an object")
        self._validate_exact_keys(
            value,
            set(delivery) | {"status", "progress", "error", "occurredAt"},
            "Applied leaf-operation result",
        )
        if any(value.get(key) != expected for key, expected in delivery.items()):
            raise ValueError("Applied leaf-operation result changed its delivery identity")
        if value["status"] != "succeeded" or value["error"] is not None:
            raise ValueError("Applied leaf-operation result must be a success without error")
        occurred_at = self._validate_expiry(
            value["occurredAt"], "Applied leaf-operation result time"
        )
        if datetime.fromisoformat(occurred_at.replace("Z", "+00:00")) < datetime.fromisoformat(
            delivery["dispatchedAt"].replace("Z", "+00:00")
        ):
            raise ValueError("Applied leaf-operation result predates delivery")
        progress = value["progress"]
        if not isinstance(progress, dict):
            raise ValueError("Applied leaf-operation result requires progress")
        self._validate_exact_keys(
            progress,
            {
                "runId",
                "bindingSha256",
                "stepId",
                "actionName",
                "recipeId",
                "catalogVersion",
                "operationIds",
                "completedOperationIds",
                "nextOrdinal",
                "latestObservation",
                "leafCompleted",
                "finalReport",
            },
            "Applied leaf-operation progress",
        )
        self._validated_required_uuid(progress["runId"], "Applied leaf-operation run id")
        self._validate_leaf_operation_recovery_sha256(
            progress["bindingSha256"], "Applied leaf-operation binding SHA-256"
        )
        ordinal = delivery["operationOrdinal"]
        expected_ids = list(delivery["operationIds"])
        completed_ids = expected_ids[:ordinal]
        if (
            progress["stepId"] != delivery["stepId"]
            or progress["actionName"] != delivery["actionName"]
            or progress["recipeId"] != delivery["recipeId"]
            or progress["catalogVersion"] != delivery["catalogVersion"]
            or progress["operationIds"] != expected_ids
            or progress["completedOperationIds"] != completed_ids
            or progress["nextOrdinal"] != ordinal + 1
        ):
            raise ValueError("Applied leaf-operation progress is not the exact delivered prefix")
        observation = progress["latestObservation"]
        if not isinstance(observation, dict):
            raise ValueError("Applied leaf-operation observation must be an object")
        self._validate_exact_keys(
            observation,
            {"kind", "satisfied", "details"},
            "Applied leaf-operation observation",
        )
        details = observation["details"]
        if not isinstance(details, dict):
            raise ValueError("Applied leaf-operation observation details must be an object")
        self._validate_exact_keys(
            details,
            {
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
            },
            "Applied leaf-operation observation details",
        )
        self._validated_required_uuid(
            details["receiptId"], "Applied leaf-operation receipt id"
        )
        before = self._validate_leaf_operation_recovery_sha256(
            details["beforeFingerprintSha256"],
            "Applied leaf-operation before fingerprint SHA-256",
        )
        after = self._validate_leaf_operation_recovery_sha256(
            details["afterFingerprintSha256"],
            "Applied leaf-operation after fingerprint SHA-256",
        )
        evidence = details["evidence"]
        final = ordinal == len(expected_ids)
        observation_profile = GUIDED_LEAF_OPERATION_OBSERVATION_PROFILES.get(
            delivery["actionName"]
        )
        if observation_profile is None:
            raise ValueError("Applied leaf-operation observation profile is unavailable")
        observation_kind, completion_evidence_key, mutating_ordinals = (
            observation_profile
        )
        expected_mutating = ordinal in mutating_ordinals
        if (
            observation["kind"] != observation_kind
            or observation["satisfied"] is not True
            or details["status"] != "passed"
            or details["direction"] != "forward"
            or details["operationOrdinal"] != ordinal
            or details["operationId"] != delivery["sourceOperationId"]
            or details["mutating"] is not expected_mutating
            or details["runId"] != progress["runId"]
            or details["stepId"] != progress["stepId"]
            or details["actionName"] != progress["actionName"]
            or details["recipeId"] != progress["recipeId"]
            or details["catalogVersion"] != progress["catalogVersion"]
            or not isinstance(evidence, dict)
            or evidence.get("completedOperations") != list(range(1, ordinal + 1))
            or evidence.get("preconditionsValidated") is not (ordinal == 1)
            or evidence.get(completion_evidence_key) is not final
            or (expected_mutating and before == after)
            or (not expected_mutating and before != after)
        ):
            raise ValueError("Applied leaf-operation observation is inconsistent")
        final_report = progress["finalReport"]
        if progress["leafCompleted"] is not final:
            raise ValueError("Applied leaf-operation completion flag is inconsistent")
        if final:
            if not isinstance(final_report, dict):
                raise ValueError("Applied final leaf operation requires its next report")
            self._validate_exact_keys(
                final_report, {"reportId", "sequence"}, "Applied final report"
            )
            self._validated_required_uuid(
                final_report["reportId"], "Applied final report id"
            )
            if (
                final_report["reportId"] == delivery["expectedState"]["reportId"]
                or final_report["sequence"]
                != delivery["expectedState"]["sequence"] + 1
            ):
                raise ValueError("Applied final report does not advance the expected state")
        elif final_report is not None:
            raise ValueError("Applied partial leaf operation cannot publish a final report")
        return deepcopy(value)

    def _validate_leaf_operation_recovery_ack(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("Leaf-operation recovery acknowledgement must be an object")
        self._validate_exact_keys(
            value,
            {
                "formatVersion",
                "challenge",
                "recoveryId",
                "requestId",
                "originalDeliveryId",
                "replacementSessionFingerprintSha256",
                "outcome",
                "evidence",
                "retainsTargetLock",
                "automaticReplay",
                "occurredAt",
            },
            "Leaf-operation recovery acknowledgement",
        )
        challenge = self._validate_leaf_operation_recovery_challenge(value["challenge"])
        delivery = challenge["originalDelivery"]
        for actual, expected, label in (
            (value["recoveryId"], challenge["recoveryId"], "recovery id"),
            (value["requestId"], delivery["requestId"], "request id"),
            (value["originalDeliveryId"], delivery["deliveryId"], "delivery id"),
            (
                value["replacementSessionFingerprintSha256"],
                challenge["replacementSessionFingerprintSha256"],
                "replacement session fingerprint",
            ),
        ):
            if actual != expected:
                raise ValueError(f"Leaf-operation recovery acknowledgement changed its {label}")
        if value["automaticReplay"] is not False:
            raise ValueError("Leaf-operation recovery acknowledgement cannot request replay")
        evidence = value["evidence"]
        if not isinstance(evidence, dict):
            raise ValueError("Leaf-operation recovery evidence must be an object")
        kind = evidence.get("kind")
        if value["outcome"] != kind:
            raise ValueError("Leaf-operation recovery outcome does not match its evidence")
        if kind == "unresolved_current_state":
            self._validate_exact_keys(
                evidence,
                {"kind", "reason", "leafRun", "currentCheckpoint"},
                "Unresolved leaf-operation recovery evidence",
            )
            if evidence["reason"] not in {
                "operation_outcome_indeterminate",
                "native_undo_outcome_indeterminate",
                "observation_outcome_indeterminate",
            }:
                raise ValueError("Unresolved leaf-operation recovery reason is invalid")
            if evidence["leafRun"] is not None:
                prefix = self._validate_leaf_operation_recovery_prefix(
                    evidence["leafRun"],
                    operation_ids=tuple(delivery["operationIds"]),
                    ordinal=delivery["operationOrdinal"],
                )
                if prefix != challenge["acceptedPrefix"]:
                    raise ValueError("Unresolved recovery leaf run changed the accepted prefix")
            if evidence["currentCheckpoint"] is not None:
                self._validate_leaf_operation_recovery_checkpoint(
                    evidence["currentCheckpoint"]
                )
            if value["retainsTargetLock"] is not True:
                raise ValueError("Unresolved recovery must retain the target lock")
        elif kind == "operation_applied":
            self._validate_exact_keys(
                evidence,
                {"kind", "terminalResult", "currentCheckpoint"},
                "Applied leaf-operation recovery evidence",
            )
            if challenge["nativeUndoGuard"] is not None:
                raise ValueError("Native Undo recovery cannot accept an applied operation")
            terminal = self._validate_leaf_operation_succeeded_result(
                evidence["terminalResult"], delivery
            )
            checkpoint = self._validate_leaf_operation_recovery_checkpoint(
                evidence["currentCheckpoint"]
            )
            progress = terminal["progress"]
            final_report = progress["finalReport"]
            expected_report = (
                final_report if final_report is not None else challenge["expectedState"]
            )
            if (
                checkpoint["reportId"] != expected_report["reportId"]
                or checkpoint["sequence"] != expected_report["sequence"]
                or checkpoint["sceneFingerprintSha256"]
                != progress["latestObservation"]["details"][
                    "afterFingerprintSha256"
                ]
                or value["retainsTargetLock"] is not False
            ):
                raise ValueError("Applied recovery does not prove its terminal Blender state")
        elif kind == "document_incarnation_retired":
            self._validate_exact_keys(
                evidence,
                {
                    "kind",
                    "reason",
                    "mutationOutcome",
                    "requiresFreshDocumentIncarnation",
                },
                "Retired document-incarnation recovery evidence",
            )
            guard = challenge["nativeUndoGuard"]
            expected_reason = (
                "native_undo_witness_lost_after_reload"
                if guard is not None
                else "runtime_recovery_evidence_lost"
            )
            if (
                evidence["reason"] != expected_reason
                or evidence["mutationOutcome"] != "indeterminate"
                or evidence["requiresFreshDocumentIncarnation"] is not True
                or value["retainsTargetLock"] is not False
            ):
                raise ValueError(
                    "Document-incarnation retirement is not bound to its recovery guard"
                )
        elif kind == "prefix_restored":
            base_keys = {
                "kind",
                "expectedState",
                "leafRun",
                "currentCheckpoint",
                "restoration",
            }
            actual_keys = set(evidence)
            if actual_keys not in {frozenset(base_keys), frozenset(base_keys | {"nativeUndoWitness"})}:
                self._validate_exact_keys(evidence, base_keys, "Restored leaf-operation evidence")
            if evidence["expectedState"] != challenge["expectedState"]:
                raise ValueError("Restored recovery expected state changed")
            prefix = self._validate_leaf_operation_recovery_prefix(
                evidence["leafRun"],
                operation_ids=tuple(delivery["operationIds"]),
                ordinal=delivery["operationOrdinal"],
            )
            if prefix != challenge["acceptedPrefix"]:
                raise ValueError("Restored recovery leaf run changed the accepted prefix")
            checkpoint = self._validate_leaf_operation_recovery_checkpoint(
                evidence["currentCheckpoint"]
            )
            if (
                checkpoint["reportId"] != challenge["expectedState"]["reportId"]
                or checkpoint["sequence"] != challenge["expectedState"]["sequence"]
                or checkpoint["sceneFingerprintSha256"]
                != challenge["acceptedPrefix"]["latestFingerprintSha256"]
            ):
                raise ValueError("Restored recovery checkpoint does not prove the accepted prefix")
            if delivery["operationOrdinal"] == 1 and checkpoint[
                "checkpointId"
            ] != challenge["authorityProof"]["authorizedStartCheckpointId"]:
                raise ValueError("Empty-prefix recovery did not restore the authorized start")
            restoration = evidence["restoration"]
            witness = evidence.get("nativeUndoWitness")
            guard = challenge["nativeUndoGuard"]
            if restoration == "native_undo_restored":
                if guard is None or not isinstance(witness, dict):
                    raise ValueError("Native Undo recovery requires its guard-bound witness")
                self._validate_exact_keys(
                    witness,
                    {
                        "sourceCheckpointId",
                        "restoredCheckpointId",
                        "recoveryTokenSha256",
                        "restoredAt",
                        "probeSatisfied",
                    },
                    "Native Undo recovery witness",
                )
                self._validated_required_uuid(
                    witness["sourceCheckpointId"], "Native Undo source checkpoint id"
                )
                if witness["restoredCheckpointId"] is not None:
                    self._validated_required_uuid(
                        witness["restoredCheckpointId"],
                        "Native Undo restored checkpoint id",
                    )
                if (
                    witness["restoredCheckpointId"] != checkpoint["checkpointId"]
                    or witness["recoveryTokenSha256"] != guard["recoveryTokenSha256"]
                    or (
                        guard["expectedRestoredCheckpointId"] is not None
                        and witness["restoredCheckpointId"]
                        != guard["expectedRestoredCheckpointId"]
                    )
                    or witness["probeSatisfied"] is not True
                ):
                    raise ValueError("Native Undo recovery witness does not match its guard")
                self._validate_expiry(witness["restoredAt"], "Native Undo restored time")
            elif restoration == "prefix_observed_without_native_undo":
                if guard is not None or witness is not None:
                    raise ValueError("Observed-prefix recovery cannot carry Native Undo evidence")
            else:
                raise ValueError("Leaf-operation recovery restoration is unsupported")
            if value["retainsTargetLock"] is not False:
                raise ValueError("Restored recovery must release the target lock")
        else:
            raise ValueError("Leaf-operation recovery evidence kind is unsupported")
        occurred_at = self._validate_expiry(
            value["occurredAt"], "Leaf-operation recovery acknowledgement time"
        )
        if datetime.fromisoformat(occurred_at.replace("Z", "+00:00")) < datetime.fromisoformat(
            challenge["requestedAt"].replace("Z", "+00:00")
        ):
            raise ValueError("Leaf-operation recovery acknowledgement predates its challenge")
        validated = deepcopy(value)
        validated["challenge"] = challenge
        return validated

    def _poll_leaf_operation_recovery_request(self) -> bool:
        response = self._request_json(
            "GET",
            "/api/v1/companion/leaf-operation-recovery?"
            + urlencode({"adapterId": "blender", "instanceId": self._instance_id}),
            abort_on_stop=True,
        )
        self._validate_exact_keys(response, {"request"}, "Leaf-operation recovery poll")
        challenge = response["request"]
        if challenge is None:
            return False
        validated = self._validate_leaf_operation_recovery_challenge(challenge)
        recovery_id = validated["recoveryId"]
        if recovery_id not in self._seen_leaf_operation_recovery_ids:
            if len(self._seen_leaf_operation_recovery_ids) >= 256:
                self._seen_leaf_operation_recovery_ids.pop()
            self._seen_leaf_operation_recovery_ids.add(recovery_id)
            self.incoming.put(
                {"kind": "leaf_operation_recovery_request", "request": validated}
            )
        return True

    @staticmethod
    def _canonical_protocol_bytes(value: Any) -> bytes:
        def length_delimited(encoded: bytes) -> bytes:
            return str(len(encoded)).encode("ascii") + b":" + encoded

        if value is None:
            return b"n"
        if value is False:
            return b"f"
        if value is True:
            return b"t"
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            number = float(value)
            if not (number == number and abs(number) != float("inf")):
                raise ValueError("Canonical protocol numbers must be finite")
            return b"d" + struct.pack(">d", 0.0 if number == 0 else number).hex().encode("ascii")
        if isinstance(value, str):
            encoded = value.encode("utf-8")
            return b"s" + str(len(encoded)).encode("ascii") + b":" + encoded
        if isinstance(value, list):
            items = b"".join(
                length_delimited(CompanionTransport._canonical_protocol_bytes(item))
                for item in value
            )
            return b"a" + str(len(value)).encode("ascii") + b":" + items
        if isinstance(value, dict) and all(isinstance(key, str) for key in value):
            entries = sorted(value.items(), key=lambda item: item[0].encode("utf-8"))
            parts = [b"o" + str(len(entries)).encode("ascii") + b":"]
            for key, item in entries:
                parts.append(length_delimited(CompanionTransport._canonical_protocol_bytes(key)))
                parts.append(length_delimited(CompanionTransport._canonical_protocol_bytes(item)))
            return b"".join(parts)
        raise ValueError("Value is not a canonical protocol JSON value")

    @staticmethod
    def _canonical_sha256(value: dict[str, Any]) -> str:
        return hashlib.sha256(CompanionTransport._canonical_protocol_bytes(value)).hexdigest()

    @staticmethod
    def _menu_control_proof_operation_ids() -> list[str]:
        return list(MENU_CONTROL_PROOF_OPERATION_IDS)

    @staticmethod
    def _menu_control_proof_timestamp(value: Any, label: str) -> datetime:
        CompanionTransport._validate_expiry(value, label)
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    def _validate_menu_control_proof_binding(self, binding: Any) -> dict[str, Any]:
        if not isinstance(binding, dict):
            raise ValueError("Menu-control proof binding must be an object")
        self._validate_exact_keys(
            binding,
            {
                "formatVersion", "bindingId", "proposalRecordContentSha256",
                "proofId", "requestId", "replayId", "target", "proposalId",
                "packetContentSha256", "inputTreeContentSha256",
                "outputTreeContentSha256", "materializationContentSha256",
                "proposalContentSha256", "plan", "executionId", "leafId",
                "recipeId", "actionName", "acceptedAction", "targetProfile",
                "acceptedDecision", "startState", "proofScope", "materialization",
                "executorId", "executionBoundary", "authorization", "transport",
                "operationIds", "nativeUndoDepth", "createdAt", "integrity",
            },
            "Menu-control proof binding",
        )
        if binding["formatVersion"] != "1.0.0":
            raise ValueError("Unsupported menu-control proof binding version")
        for field in (
            "bindingId", "proofId", "requestId", "replayId", "proposalId", "executionId"
        ):
            self._validated_required_uuid(binding[field], f"Menu-control proof binding {field}")
        target = binding["target"]
        if not isinstance(target, dict):
            raise ValueError("Edit Subdivide binding target must be an object")
        self._validate_exact_keys(
            target, {"adapterId", "instanceId"}, "Edit Subdivide binding target"
        )
        if target != {"adapterId": "blender", "instanceId": self._instance_id}:
            raise ValueError("Menu-control proof binding targets another Companion")
        self._validate_exact_keys(target, {"adapterId", "instanceId"}, "Menu-control proof target")
        self._validated_required_uuid(target["instanceId"], "Menu-control proof instance id")
        hashes = (
            "proposalRecordContentSha256", "packetContentSha256",
            "inputTreeContentSha256", "outputTreeContentSha256",
            "materializationContentSha256", "proposalContentSha256",
        )
        if any(
            not isinstance(binding[field], str)
            or CONTENT_SHA256_PATTERN.fullmatch(binding[field]) is None
            for field in hashes
        ):
            raise ValueError("Menu-control proof binding contains an invalid content hash")
        plan = binding["plan"]
        if not isinstance(plan, dict):
            raise ValueError("Menu-control proof plan must be an object")
        self._validate_exact_keys(plan, {"id", "revision", "contentSha256"}, "Menu-control proof plan")
        if (
            not isinstance(plan["id"], str) or not plan["id"]
            or isinstance(plan["revision"], bool) or not isinstance(plan["revision"], int)
            or plan["revision"] <= 0
            or not isinstance(plan["contentSha256"], str)
            or CONTENT_SHA256_PATTERN.fullmatch(plan["contentSha256"]) is None
        ):
            raise ValueError("Menu-control proof plan identity is invalid")
        if not isinstance(binding["leafId"], str) or not binding["leafId"]:
            raise ValueError("Menu-control proof leaf id must be non-empty text")
        accepted_action = binding["acceptedAction"]
        expected_action = {
            "adapterId": "blender",
            "name": "blender.mesh.create_uv_sphere",
            "arguments": {
                "resourceId": "proof.uv_sphere.eye",
                "objectName": "OperatingLine.TutorialEye",
                "radius": 1.5,
                "location": [1.25, -2, 0.75],
            },
        }
        if accepted_action != expected_action:
            raise ValueError("Menu-control proof accepted action is not the fixed UV Sphere action")
        if (
            binding["recipeId"] != "blender.mesh.create_uv_sphere.native"
            or binding["actionName"] != "blender.mesh.create_uv_sphere"
            or binding["targetProfile"] != MENU_CONTROL_PROOF_TARGET_PROFILE
            or binding["executorId"] != MENU_CONTROL_PROOF_EXECUTOR_ID
            or binding["executionBoundary"] != "blender_window_event_simulate"
            or binding["authorization"] != "accepted_replay_next_step"
            or binding["transport"] != "event_simulate"
            or binding["operationIds"] != list(MENU_CONTROL_PROOF_OPERATION_IDS)
            or binding["nativeUndoDepth"] != 8
        ):
            raise ValueError("Menu-control proof fixed executor declaration is invalid")
        proof_scope = binding["proofScope"]
        if proof_scope != {
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "managedReceiptCreated": False,
            "omittedAcceptedArguments": ["resourceId"],
        }:
            raise ValueError("Menu-control proof scope is invalid")
        materialization = binding["materialization"]
        if not isinstance(materialization, dict):
            raise ValueError("Menu-control proof materialization must be an object")
        self._validate_exact_keys(
            materialization,
            {
                "actionCatalogVersion", "interactionCatalogVersion",
                "interactionCatalogContentSha256", "packetContentSha256",
                "inputTreeContentSha256", "outputTreeContentSha256",
                "materializationContentSha256", "menuTrackContentSha256",
            },
            "Menu-control proof materialization",
        )
        for field in (
            "interactionCatalogContentSha256", "packetContentSha256",
            "inputTreeContentSha256", "outputTreeContentSha256",
            "materializationContentSha256", "menuTrackContentSha256",
        ):
            if not isinstance(materialization[field], str) or CONTENT_SHA256_PATTERN.fullmatch(materialization[field]) is None:
                raise ValueError("Menu-control proof materialization hash is invalid")
        semver = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)")
        if (
            materialization["actionCatalogVersion"] != BLENDER_ACTION_CATALOG_VERSION
            or not isinstance(materialization["interactionCatalogVersion"], str)
            or semver.fullmatch(materialization["interactionCatalogVersion"]) is None
        ):
            raise ValueError("Menu-control proof catalog authority is invalid")
        for field in (
            "packetContentSha256", "inputTreeContentSha256",
            "outputTreeContentSha256", "materializationContentSha256",
        ):
            if binding[field] != materialization[field]:
                raise ValueError("Menu-control proof binding materialization identity changed")
        start = binding["startState"]
        if not isinstance(start, dict):
            raise ValueError("Menu-control proof start state must be an object")
        self._validate_exact_keys(
            start,
            {
                "reportId", "sequence", "adapterId", "instanceId", "plan",
                "planContentSha256", "executionId", "phase", "activeStepId",
                "completedStepIds", "transition", "stepId", "observationCount",
                "nativeUndoCheckpoint", "occurredAt",
            },
            "Menu-control proof start state",
        )
        self._validated_required_uuid(start["reportId"], "Menu-control proof start report id")
        if (
            start["adapterId"] != "blender" or start["instanceId"] != self._instance_id
            or start["plan"] != {"id": plan["id"], "revision": plan["revision"]}
            or start["planContentSha256"] != plan["contentSha256"]
            or start["executionId"] != binding["executionId"]
            or start["phase"] != "running" or start["activeStepId"] is not None
            or start["completedStepIds"] != [] or start["transition"] != "walkthrough_started"
            or start["stepId"] is not None or start["observationCount"] != 0
            or isinstance(start["sequence"], bool) or not isinstance(start["sequence"], int)
            or start["sequence"] <= 0 or not isinstance(start["nativeUndoCheckpoint"], dict)
        ):
            raise ValueError("Menu-control proof start state is invalid")
        checkpoint = start["nativeUndoCheckpoint"]
        self._validate_exact_keys(
            checkpoint,
            {
                "formatVersion", "evidenceClass", "checkpointId",
                "previousCheckpointId", "operation", "committedAt", "marker",
                "journal", "session",
            },
            "Menu-control proof pristine start checkpoint",
        )
        self._validated_required_uuid(checkpoint["checkpointId"], "Menu-control proof start checkpoint id")
        if (
            checkpoint["formatVersion"] != "1.0.0"
            or checkpoint["evidenceClass"] != "companion_reported_native_undo_checkpoint"
            or checkpoint["previousCheckpointId"] is not None
            or checkpoint["operation"] != "start"
            or checkpoint["marker"] != {"key": "_operating_line_native_history_v1", "matched": True}
            or checkpoint["journal"] != {
                "entryPresent": True,
                "snapshotMatchesSession": True,
                "artifactsBackedUp": True,
            }
        ):
            raise ValueError("Menu-control proof pristine start checkpoint is invalid")
        checkpoint_session = checkpoint["session"]
        if not isinstance(checkpoint_session, dict):
            raise ValueError("Menu-control proof checkpoint session must be an object")
        self._validate_exact_keys(
            checkpoint_session,
            {
                "plan", "planContentSha256", "executionId", "activeStepId",
                "completedStepIds", "receiptStepIds",
            },
            "Menu-control proof checkpoint session",
        )
        if checkpoint_session != {
            "plan": {"id": plan["id"], "revision": plan["revision"]},
            "planContentSha256": plan["contentSha256"],
            "executionId": binding["executionId"],
            "activeStepId": None,
            "completedStepIds": [],
            "receiptStepIds": [],
        }:
            raise ValueError("Menu-control proof checkpoint session identity is invalid")
        decision = binding["acceptedDecision"]
        if not isinstance(decision, dict):
            raise ValueError("Menu-control proof accepted decision must be an object")
        self._validate_exact_keys(
            decision,
            {"decisionId", "proposalId", "instanceId", "adapterId", "decision", "decidedAt"},
            "Menu-control proof accepted decision",
        )
        self._validated_required_uuid(decision["decisionId"], "Menu-control proof decision id")
        if (
            decision["proposalId"] != binding["proposalId"]
            or decision["instanceId"] != self._instance_id
            or decision["adapterId"] != "blender" or decision["decision"] != "accepted"
        ):
            raise ValueError("Menu-control proof accepted decision identity is invalid")
        created_at = self._menu_control_proof_timestamp(binding["createdAt"], "Menu-control proof binding creation time")
        decision_at = self._menu_control_proof_timestamp(decision["decidedAt"], "Menu-control proof decision time")
        checkpoint_at = self._menu_control_proof_timestamp(checkpoint["committedAt"], "Menu-control proof start checkpoint time")
        start_at = self._menu_control_proof_timestamp(start["occurredAt"], "Menu-control proof start report time")
        if not decision_at <= checkpoint_at <= start_at <= created_at:
            raise ValueError("Menu-control proof binding predates acceptance")
        integrity = binding["integrity"]
        if not isinstance(integrity, dict):
            raise ValueError("Menu-control proof binding integrity must be an object")
        self._validate_exact_keys(integrity, {"algorithm", "canonicalization", "contentSha256"}, "Menu-control proof binding integrity")
        content = {key: value for key, value in binding.items() if key != "integrity"}
        if integrity != {
            "algorithm": "sha256",
            "canonicalization": "operatingline-json-value-v1",
            "contentSha256": self._canonical_sha256(content),
        }:
            raise ValueError("Menu-control proof binding content hash is invalid")
        return binding

    def _validate_menu_control_proof_identity(self, payload: Any, label: str) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError(f"{label} must be an object")
        base_keys = {
            "formatVersion", "requestId", "replayId", "proofId", "target",
            "targetProfile", "proposalId", "proposalRecordContentSha256",
            "proposalContentSha256", "plan", "executionId", "leafId",
            "packetContentSha256", "inputTreeContentSha256", "outputTreeContentSha256",
            "materializationContentSha256", "interactionCatalogVersion",
            "interactionCatalogContentSha256", "menuTrackContentSha256",
            "bindingContentSha256", "binding", "executorId", "executionBoundary",
            "authorization", "transport", "operationIds", "nativeUndoDepth",
            "expectedState", "startCheckpoint", "requestedAt", "deliveryId",
            "lease", "dispatchedAt",
        }
        if not base_keys.issubset(payload):
            raise ValueError(f"{label} is missing delivery identity fields")
        if payload["formatVersion"] != "1.0.0":
            raise ValueError(f"{label} version is unsupported")
        for field in ("requestId", "replayId", "proofId", "proposalId", "executionId", "deliveryId"):
            self._validated_required_uuid(payload[field], f"{label} {field}")
        binding = self._validate_menu_control_proof_binding(payload["binding"])
        if payload["bindingContentSha256"] != binding["integrity"]["contentSha256"]:
            raise ValueError(f"{label} binding content hash changed")
        direct_fields = (
            "requestId", "replayId", "proofId", "target", "targetProfile", "proposalId",
            "proposalRecordContentSha256", "proposalContentSha256", "plan", "executionId",
            "leafId", "packetContentSha256", "inputTreeContentSha256",
            "outputTreeContentSha256", "materializationContentSha256", "executorId",
            "executionBoundary", "authorization", "transport", "operationIds", "nativeUndoDepth",
        )
        if any(payload[field] != binding[field] for field in direct_fields):
            raise ValueError(f"{label} immutable binding identity changed")
        materialization = binding["materialization"]
        for field in ("interactionCatalogVersion", "interactionCatalogContentSha256", "menuTrackContentSha256"):
            if payload[field] != materialization[field]:
                raise ValueError(f"{label} catalog identity changed")
        expected_state = payload["expectedState"]
        if expected_state != {"reportId": binding["startState"]["reportId"], "sequence": binding["startState"]["sequence"]}:
            raise ValueError(f"{label} expected start report changed")
        if payload["startCheckpoint"] != binding["startState"]:
            raise ValueError(f"{label} start checkpoint changed")
        lease = payload["lease"]
        if not isinstance(lease, dict):
            raise ValueError(f"{label} lease must be an object")
        self._validate_exact_keys(
            lease, {"leaseId", "sessionId", "target", "documentIncarnationId", "expiresAt"},
            f"{label} lease",
        )
        for field in ("leaseId", "sessionId", "documentIncarnationId"):
            self._validated_required_uuid(lease[field], f"{label} lease {field}")
        if (
            lease["sessionId"] != self._session_id
            or lease["documentIncarnationId"] != self._document_incarnation_id
            or lease["target"] != payload["target"]
        ):
            raise ValueError(f"{label} lease session or document identity changed")
        created = self._menu_control_proof_timestamp(binding["createdAt"], f"{label} binding time")
        requested = self._menu_control_proof_timestamp(payload["requestedAt"], f"{label} request time")
        dispatched = self._menu_control_proof_timestamp(payload["dispatchedAt"], f"{label} dispatch time")
        expires = self._menu_control_proof_timestamp(lease["expiresAt"], f"{label} lease expiry")
        if not created <= requested <= dispatched < expires:
            raise ValueError(f"{label} delivery chronology is invalid")
        return payload

    def _validate_menu_control_proof_delivery(self, delivery: Any) -> dict[str, Any]:
        validated = self._validate_menu_control_proof_identity(delivery, "Menu-control proof delivery")
        expected = {
            "formatVersion", "requestId", "replayId", "proofId", "target",
            "targetProfile", "proposalId", "proposalRecordContentSha256",
            "proposalContentSha256", "plan", "executionId", "leafId",
            "packetContentSha256", "inputTreeContentSha256", "outputTreeContentSha256",
            "materializationContentSha256", "interactionCatalogVersion",
            "interactionCatalogContentSha256", "menuTrackContentSha256",
            "bindingContentSha256", "binding", "executorId", "executionBoundary",
            "authorization", "transport", "operationIds", "nativeUndoDepth",
            "expectedState", "startCheckpoint", "requestedAt", "deliveryId", "lease", "dispatchedAt",
        }
        self._validate_exact_keys(validated, expected, "Menu-control proof delivery")
        session = self._session_snapshot
        if (
            session is None
            or (
                validated["lease"]["leaseId"] != session.lease_id
                and validated["requestId"]
                not in self._seen_menu_control_proof_request_ids
            )
            or validated["lease"]["sessionId"] != session.session_id
            or validated["lease"]["documentIncarnationId"]
            != session.document_incarnation_id
        ):
            raise ValueError("Menu-control proof delivery does not use the current document lease")
        return validated

    def _validate_menu_control_proof_receipts(
        self, receipts: Any, identity: dict[str, Any], *, complete: bool
    ) -> list[dict[str, Any]]:
        if not isinstance(receipts, list) or not (1 <= len(receipts) <= 7) or (complete and len(receipts) != 7):
            raise ValueError("Menu-control proof receipt chain length is invalid")
        summaries = (
            {"status": "precondition_verified", "path": ["Layout"]},
            {"status": "control_executed", "path": ["Layout", "Add"]},
            {"status": "control_executed", "path": ["Layout", "Add", "Mesh"]},
            {"status": "control_executed", "path": ["Layout", "Add", "Mesh", "UV Sphere"], "radius": 1},
            {"status": "control_executed", "path": ["Sidebar", "Item", "Transform", "Location"], "value": [1.25, -2, 0.75]},
            {"status": "control_executed", "path": ["Sidebar", "Item", "Transform", "Scale"], "value": [1.5, 1.5, 1.5]},
            {"status": "control_executed", "path": ["Properties", "Object", "Name"], "value": "OperatingLine.TutorialEye"},
        )
        previous: str | None = None
        previous_time = self._menu_control_proof_timestamp(identity["dispatchedAt"], "Menu-control proof dispatch time")
        occurred_at = self._menu_control_proof_timestamp(identity["occurredAt"], "Menu-control proof evidence time")
        for index, receipt in enumerate(receipts):
            if not isinstance(receipt, dict):
                raise ValueError("Menu-control proof receipt must be an object")
            self._validate_exact_keys(
                receipt,
                {"receiptId", "proofId", "requestId", "deliveryId", "bindingContentSha256", "order", "previousReceiptContentSha256", "outcome", "occurredAt", "contentSha256", "operationId", "summary"},
                "Menu-control proof receipt",
            )
            self._validated_required_uuid(receipt["receiptId"], "Menu-control proof receipt id")
            if (
                receipt["proofId"] != identity["proofId"]
                or receipt["requestId"] != identity["requestId"]
                or receipt["deliveryId"] != identity["deliveryId"]
                or receipt["bindingContentSha256"] != identity["bindingContentSha256"]
                or receipt["operationId"] != MENU_CONTROL_PROOF_OPERATION_IDS[index]
                or receipt["order"] != index + 1 or receipt["outcome"] != "succeeded"
                or receipt["summary"] != summaries[index]
                or receipt["previousReceiptContentSha256"] != previous
            ):
                raise ValueError("Menu-control proof receipt identity, order, or summary is invalid")
            receipt_time = self._menu_control_proof_timestamp(receipt["occurredAt"], "Menu-control proof receipt time")
            if not previous_time <= receipt_time <= occurred_at:
                raise ValueError("Menu-control proof receipt chronology is invalid")
            content = {key: value for key, value in receipt.items() if key != "contentSha256"}
            if receipt["contentSha256"] != self._canonical_sha256(content):
                raise ValueError("Menu-control proof receipt content hash is invalid")
            previous = receipt["contentSha256"]
            previous_time = receipt_time
        return receipts

    def _validate_menu_control_proof_progress(self, progress: Any) -> dict[str, Any]:
        validated = self._validate_menu_control_proof_identity(progress, "Menu-control proof progress")
        delivery_keys = set(self._validate_menu_control_proof_delivery_keys())
        self._validate_exact_keys(
            validated,
            delivery_keys | {"status", "completedOperationIds", "operationReceipts", "receiptChainHeadSha256", "nativeHistoryCursor", "completedMutationStages", "occurredAt"},
            "Menu-control proof progress",
        )
        receipts = self._validate_menu_control_proof_receipts(validated["operationReceipts"], validated, complete=False)
        count = len(receipts)
        mutation_count = (0, 0, 0, 1, 4, 7, 8)[count - 1]
        occurred_at = self._menu_control_proof_timestamp(validated["occurredAt"], "Menu-control proof progress time")
        execution_deadline = (
            self._menu_control_proof_timestamp(
                validated["dispatchedAt"], "Menu-control proof dispatch time"
            )
            + timedelta(seconds=120)
        )
        if (
            validated["status"] != "in_progress"
            or validated["completedOperationIds"] != list(MENU_CONTROL_PROOF_OPERATION_IDS[:count])
            or validated["receiptChainHeadSha256"] != receipts[-1]["contentSha256"]
            or validated["nativeHistoryCursor"] != mutation_count
            or validated["completedMutationStages"] != list(MENU_CONTROL_PROOF_MUTATION_STAGES[:mutation_count])
            or not self._menu_control_proof_timestamp(validated["dispatchedAt"], "Menu-control proof dispatch time") <= occurred_at <= execution_deadline
        ):
            raise ValueError("Menu-control proof progress is not an exact logical prefix")
        return validated

    @staticmethod
    def _validate_menu_control_proof_delivery_keys() -> tuple[str, ...]:
        return (
            "formatVersion", "requestId", "replayId", "proofId", "target", "targetProfile",
            "proposalId", "proposalRecordContentSha256", "proposalContentSha256", "plan",
            "executionId", "leafId", "packetContentSha256", "inputTreeContentSha256",
            "outputTreeContentSha256", "materializationContentSha256", "interactionCatalogVersion",
            "interactionCatalogContentSha256", "menuTrackContentSha256", "bindingContentSha256",
            "binding", "executorId", "executionBoundary", "authorization", "transport",
            "operationIds", "nativeUndoDepth", "expectedState", "startCheckpoint", "requestedAt",
            "deliveryId", "lease", "dispatchedAt",
        )

    def _validate_menu_control_proof_result(self, result: Any) -> dict[str, Any]:
        validated = self._validate_menu_control_proof_identity(result, "Menu-control proof result")
        self._validate_exact_keys(
            validated,
            set(self._validate_menu_control_proof_delivery_keys()) | {
                "status", "managedActionResult", "managedIdentityVerified",
                "managedReceiptCreated", "requiresUndoToUnlock", "terminalEvidence",
                "error", "occurredAt",
            },
            "Menu-control proof result",
        )
        statuses = {"succeeded", "failed_no_mutation", "failed_restored", "failed_checkpointed", "recovery_required"}
        status = validated["status"]
        if (
            status not in statuses or validated["managedActionResult"] != "not_executed"
            or validated["managedIdentityVerified"] is not False
            or validated["managedReceiptCreated"] is not False
            or validated["requiresUndoToUnlock"] is not (status in {"succeeded", "failed_checkpointed", "recovery_required"})
            or (status == "succeeded") is not (validated["error"] is None)
            or (validated["error"] is not None and (not isinstance(validated["error"], str) or not validated["error"]))
        ):
            raise ValueError("Menu-control proof result status claims are invalid")
        occurred_at = self._menu_control_proof_timestamp(validated["occurredAt"], "Menu-control proof result time")
        dispatched_at = self._menu_control_proof_timestamp(
            validated["dispatchedAt"], "Menu-control proof dispatch time"
        )
        if not dispatched_at <= occurred_at <= dispatched_at + timedelta(seconds=120):
            raise ValueError("Menu-control proof result chronology is invalid")
        evidence = validated["terminalEvidence"]
        if not isinstance(evidence, dict):
            raise ValueError("Menu-control proof terminal evidence must be an object")
        expected_kind = "succeeded_locked" if status == "succeeded" else status
        if evidence.get("kind") != expected_kind:
            raise ValueError("Menu-control proof terminal evidence kind disagrees with status")
        if status == "succeeded":
            self._validate_exact_keys(evidence, {"kind", "operationSummaries", "operationReceipts", "strongObservation", "nativeUndoCheckpoint"}, "Menu-control proof success evidence")
            receipts = self._validate_menu_control_proof_receipts(evidence["operationReceipts"], validated, complete=True)
            summaries = evidence["operationSummaries"]
            if not isinstance(summaries, list) or summaries != [
                {"operationId": receipt["operationId"], "summaryContentSha256": self._canonical_sha256(receipt["summary"])}
                for receipt in receipts
            ]:
                raise ValueError("Menu-control proof operation summaries are invalid")
            observation = evidence["strongObservation"]
            if not isinstance(observation, dict):
                raise ValueError("Menu-control proof strong observation must be an object")
            self._validate_exact_keys(observation, {"kind", "satisfied", "observationId", "objectName", "objectType", "location", "scale", "meshTopology", "meshSha256", "sceneFingerprintSha256", "observedAt", "contentSha256"}, "Menu-control proof strong observation")
            self._validated_required_uuid(observation["observationId"], "Menu-control proof observation id")
            if (
                observation["kind"] != "uv_sphere_menu_controls_ready" or observation["satisfied"] is not True
                or observation["objectName"] != "OperatingLine.TutorialEye" or observation["objectType"] != "MESH"
                or observation["location"] != [1.25, -2, 0.75] or observation["scale"] != [1.5, 1.5, 1.5]
                or observation["meshTopology"] != {"vertices": 482, "edges": 992, "polygons": 512}
                or observation["contentSha256"] != self._canonical_sha256({key: value for key, value in observation.items() if key != "contentSha256"})
            ):
                raise ValueError("Menu-control proof strong observation is invalid")
            for field in ("meshSha256", "sceneFingerprintSha256"):
                if not isinstance(observation[field], str) or CONTENT_SHA256_PATTERN.fullmatch(observation[field]) is None:
                    raise ValueError("Menu-control proof observation hash is invalid")
            checkpoint = evidence["nativeUndoCheckpoint"]
            if not isinstance(checkpoint, dict):
                raise ValueError("Menu-control proof checkpoint must be an object")
            self._validate_exact_keys(checkpoint, {"checkpointId", "undoLockId", "nativeUndoDepth", "nativeHistoryCursor", "mutationStages", "baselineSceneFingerprintSha256", "finalSceneFingerprintSha256", "restoredSceneFingerprintSha256", "reappliedSceneFingerprintSha256", "receiptChainRootSha256", "receiptChainHeadSha256", "strongObservationContentSha256", "committedAt"}, "Menu-control proof checkpoint")
            self._validated_required_uuid(checkpoint["checkpointId"], "Menu-control proof checkpoint id")
            self._validated_required_uuid(checkpoint["undoLockId"], "Menu-control proof undo lock id")
            for field in (
                "baselineSceneFingerprintSha256",
                "finalSceneFingerprintSha256",
                "restoredSceneFingerprintSha256",
                "reappliedSceneFingerprintSha256",
                "receiptChainRootSha256",
                "receiptChainHeadSha256",
                "strongObservationContentSha256",
            ):
                if (
                    not isinstance(checkpoint[field], str)
                    or CONTENT_SHA256_PATTERN.fullmatch(checkpoint[field]) is None
                ):
                    raise ValueError("Menu-control proof checkpoint hash is invalid")
            if (
                checkpoint["nativeUndoDepth"] != 8 or checkpoint["nativeHistoryCursor"] != 8
                or checkpoint["mutationStages"] != list(MENU_CONTROL_PROOF_MUTATION_STAGES)
                or checkpoint["receiptChainRootSha256"] != receipts[0]["contentSha256"]
                or checkpoint["receiptChainHeadSha256"] != receipts[-1]["contentSha256"]
                or checkpoint["strongObservationContentSha256"] != observation["contentSha256"]
                or checkpoint["finalSceneFingerprintSha256"] != observation["sceneFingerprintSha256"]
                or checkpoint["baselineSceneFingerprintSha256"] == checkpoint["finalSceneFingerprintSha256"]
                or checkpoint["restoredSceneFingerprintSha256"] != checkpoint["baselineSceneFingerprintSha256"]
                or checkpoint["reappliedSceneFingerprintSha256"] != checkpoint["finalSceneFingerprintSha256"]
            ):
                raise ValueError("Menu-control proof checkpoint is invalid")
            if not (
                self._menu_control_proof_timestamp(receipts[-1]["occurredAt"], "Menu-control proof last receipt time")
                <= self._menu_control_proof_timestamp(observation["observedAt"], "Menu-control proof observation time")
                <= self._menu_control_proof_timestamp(checkpoint["committedAt"], "Menu-control proof checkpoint time")
                <= occurred_at
            ):
                raise ValueError("Menu-control proof success evidence chronology is invalid")
        else:
            common = {"kind", "receiptPrefix", "lastCompletedOperationId", "internalHistoryCursor", "completedMutationStages", "automaticReplay"}
            if status != "failed_no_mutation":
                common |= {"baselineSceneFingerprintSha256", "currentSceneFingerprintSha256"}
            if status == "failed_checkpointed":
                common.add("checkpoint")
            self._validate_exact_keys(evidence, common, "Menu-control proof failure evidence")
            receipts = evidence["receiptPrefix"]
            if status == "failed_no_mutation":
                if receipts != [] or evidence["lastCompletedOperationId"] is not None or evidence["internalHistoryCursor"] != 0 or evidence["completedMutationStages"] != [] or evidence["automaticReplay"] is not False:
                    raise ValueError("Menu-control proof no-mutation evidence is invalid")
            else:
                if not isinstance(receipts, list):
                    raise ValueError("Menu-control proof failure receipt prefix is invalid")
                if receipts:
                    self._validate_menu_control_proof_receipts(receipts, validated, complete=False)
                if (
                    evidence["lastCompletedOperationId"] != (receipts[-1]["operationId"] if receipts else None)
                    or evidence["automaticReplay"] is not False
                    or not isinstance(evidence["internalHistoryCursor"], int)
                    or isinstance(evidence["internalHistoryCursor"], bool)
                    or not 0 <= evidence["internalHistoryCursor"] <= 8
                    or evidence["completedMutationStages"] != list(MENU_CONTROL_PROOF_MUTATION_STAGES[:len(evidence["completedMutationStages"])])
                ):
                    raise ValueError("Menu-control proof failure prefix is invalid")
                minimum_stages, maximum_stages = (
                    (0, 0), (0, 0), (0, 0), (0, 1),
                    (1, 4), (4, 7), (7, 8), (8, 8),
                )[len(receipts)]
                stage_count = len(evidence["completedMutationStages"])
                if not minimum_stages <= stage_count <= maximum_stages:
                    raise ValueError("Menu-control proof failure mutation-stage count is invalid")
                for field in ("baselineSceneFingerprintSha256", "currentSceneFingerprintSha256"):
                    if not isinstance(evidence[field], str) or CONTENT_SHA256_PATTERN.fullmatch(evidence[field]) is None:
                        raise ValueError("Menu-control proof failure scene hash is invalid")
                if status == "failed_restored" and (
                    evidence["internalHistoryCursor"] != 0
                    or evidence["currentSceneFingerprintSha256"] != evidence["baselineSceneFingerprintSha256"]
                ):
                    raise ValueError("Menu-control proof restored evidence is invalid")
                if status == "recovery_required" and (
                    evidence["internalHistoryCursor"] > stage_count
                    or (
                        evidence["internalHistoryCursor"] != stage_count
                        and (
                            len(receipts) != 7
                            or stage_count != len(MENU_CONTROL_PROOF_MUTATION_STAGES)
                        )
                    )
                ):
                    raise ValueError("Menu-control proof recovery evidence is invalid")
                if status == "failed_checkpointed":
                    checkpoint = evidence["checkpoint"]
                    if not receipts or stage_count < 1 or not isinstance(checkpoint, dict):
                        raise ValueError("Menu-control proof failure checkpoint must be an object")
                    self._validate_exact_keys(checkpoint, {"formatVersion", "checkpointId", "undoLockId", "proofId", "replayId", "target", "internalHistoryCursor", "completedMutationStages", "baselineSceneFingerprintSha256", "currentSceneFingerprintSha256", "receiptChainRootSha256", "receiptChainHeadSha256", "committedAt", "contentSha256"}, "Menu-control proof failure checkpoint")
                    content = {key: value for key, value in checkpoint.items() if key != "contentSha256"}
                    self._validated_required_uuid(checkpoint["checkpointId"], "Menu-control proof failure checkpoint id")
                    self._validated_required_uuid(checkpoint["undoLockId"], "Menu-control proof failure undo lock id")
                    committed_at = self._menu_control_proof_timestamp(
                        checkpoint["committedAt"], "Menu-control proof failure checkpoint time"
                    )
                    last_receipt_at = (
                        self._menu_control_proof_timestamp(
                            receipts[-1]["occurredAt"], "Menu-control proof last failure receipt time"
                        )
                        if receipts
                        else self._menu_control_proof_timestamp(
                            validated["dispatchedAt"], "Menu-control proof dispatch time"
                        )
                    )
                    if (
                        checkpoint["formatVersion"] != "1.0.0" or checkpoint["proofId"] != validated["proofId"]
                        or checkpoint["replayId"] != validated["replayId"]
                        or checkpoint["target"] != {**validated["target"], "resourceId": "proof.uv_sphere.eye"}
                        or checkpoint["internalHistoryCursor"] != evidence["internalHistoryCursor"]
                        or evidence["internalHistoryCursor"] != stage_count
                        or checkpoint["completedMutationStages"] != evidence["completedMutationStages"]
                        or checkpoint["baselineSceneFingerprintSha256"] != evidence["baselineSceneFingerprintSha256"]
                        or checkpoint["currentSceneFingerprintSha256"] != evidence["currentSceneFingerprintSha256"]
                        or checkpoint["currentSceneFingerprintSha256"]
                        == checkpoint["baselineSceneFingerprintSha256"]
                        or checkpoint["receiptChainRootSha256"] != receipts[0]["contentSha256"]
                        or checkpoint["receiptChainHeadSha256"] != receipts[-1]["contentSha256"]
                        or not last_receipt_at <= committed_at <= occurred_at
                        or checkpoint["contentSha256"] != self._canonical_sha256(content)
                    ):
                        raise ValueError("Menu-control proof failure checkpoint is invalid")
        return validated

    def _validate_menu_control_terminal_reconciliation_delivery(
        self, delivery: Any
    ) -> dict[str, Any]:
        validated = self._validate_menu_control_proof_identity(
            delivery, "Menu-control terminal reconciliation"
        )
        self._validate_exact_keys(
            validated,
            set(self._validate_menu_control_proof_delivery_keys())
            | {
                "kind",
                "recoveryId",
                "replacementLease",
                "acknowledgedProgressReceiptChainHeads",
                "recoveryRequestedAt",
            },
            "Menu-control terminal reconciliation",
        )
        if validated["kind"] != "native_terminal_reconcile":
            raise ValueError("Menu-control reconciliation kind is invalid")
        self._validated_required_uuid(
            validated["recoveryId"], "Menu-control reconciliation recovery id"
        )
        heads = validated["acknowledgedProgressReceiptChainHeads"]
        if (
            not isinstance(heads, list)
            or len(heads) > 7
            or len(set(heads)) != len(heads)
            or any(
                not isinstance(value, str)
                or CONTENT_SHA256_PATTERN.fullmatch(value) is None
                for value in heads
            )
        ):
            raise ValueError("Menu-control reconciliation receipt prefix is invalid")
        replacement = validated["replacementLease"]
        if not isinstance(replacement, dict):
            raise ValueError("Menu-control reconciliation replacement lease is invalid")
        self._validate_exact_keys(
            replacement,
            {"leaseId", "sessionId", "target", "documentIncarnationId", "expiresAt"},
            "Menu-control reconciliation replacement lease",
        )
        for field in ("leaseId", "sessionId", "documentIncarnationId"):
            self._validated_required_uuid(
                replacement[field], f"Menu-control reconciliation replacement {field}"
            )
        session = self._session_snapshot
        replacement_identity = {
            key: replacement[key]
            for key in (
                "leaseId",
                "sessionId",
                "target",
                "documentIncarnationId",
            )
        }
        expected_replacement_identity = (
            None
            if session is None
            else {
                "leaseId": session.lease_id,
                "sessionId": session.session_id,
                "target": {"adapterId": "blender", "instanceId": self._instance_id},
                "documentIncarnationId": session.document_incarnation_id,
            }
        )
        requested_at = self._menu_control_proof_timestamp(
            validated["recoveryRequestedAt"],
            "Menu-control reconciliation request time",
        )
        if (
            replacement_identity != expected_replacement_identity
            or replacement["leaseId"] == validated["lease"]["leaseId"]
            or not self._menu_control_proof_timestamp(
                validated["dispatchedAt"], "Menu-control proof dispatch time"
            )
            <= requested_at
            < self._menu_control_proof_timestamp(
                replacement["expiresAt"], "Menu-control replacement lease expiry"
            )
        ):
            raise ValueError(
                "Menu-control reconciliation does not use the current replacement lease"
            )
        return validated

    def _validate_menu_control_history_identity(
        self, history: Any, label: str
    ) -> dict[str, Any]:
        if not isinstance(history, dict):
            raise ValueError(f"{label} must be an object")
        self._validate_exact_keys(
            history,
            {
                "checkpointId", "undoLockId", "checkpointKind",
                "stageFingerprints", "terminalResultContentSha256",
                "terminalMarkerContentSha256",
            },
            label,
        )
        self._validated_required_uuid(history["checkpointId"], f"{label} checkpoint id")
        self._validated_required_uuid(history["undoLockId"], f"{label} Undo lock id")
        if history["checkpointKind"] not in {"success", "failure"}:
            raise ValueError(f"{label} checkpoint kind is invalid")
        fingerprints = history["stageFingerprints"]
        if (
            not isinstance(fingerprints, list)
            or len(fingerprints) != 9
            or any(
                not isinstance(value, str)
                or CONTENT_SHA256_PATTERN.fullmatch(value) is None
                for value in fingerprints
            )
        ):
            raise ValueError(f"{label} stage fingerprints are invalid")
        if history["checkpointKind"] == "success":
            if len(set(fingerprints)) != 9:
                raise ValueError(f"{label} success stages must be distinct")
        elif fingerprints[0] == fingerprints[1] or any(
            value != fingerprints[1] for value in fingerprints[1:]
        ):
            raise ValueError(f"{label} failure stages are invalid")
        for field in (
            "terminalResultContentSha256", "terminalMarkerContentSha256"
        ):
            if (
                not isinstance(history[field], str)
                or CONTENT_SHA256_PATTERN.fullmatch(history[field]) is None
            ):
                raise ValueError(f"{label} {field} is invalid")
        return history

    @staticmethod
    def _menu_control_history_status(
        history: dict[str, Any], cursor: Any
    ) -> str:
        if cursor is not None and (
            isinstance(cursor, bool)
            or not isinstance(cursor, int)
            or cursor not in range(9)
        ):
            raise ValueError("Menu-control history cursor is invalid")
        if history["checkpointKind"] == "success" and cursor is None:
            raise ValueError("Menu-control success history cursor is invalid")
        if history["checkpointKind"] == "failure" and cursor not in {None, 0}:
            raise ValueError("Menu-control failure history cursor is invalid")
        return "restored" if cursor == 0 else "history_locked"

    def _validate_menu_control_history_transition(
        self,
        transition: Any,
        history: dict[str, Any],
        from_cursor: Any,
        from_status: Any,
    ) -> dict[str, Any]:
        if not isinstance(transition, dict):
            raise ValueError("Menu-control history transition must be an object")
        self._validate_exact_keys(
            transition,
            {
                "transitionId", "checkpointId", "undoLockId", "direction",
                "fromCursor", "toCursor", "stage", "status",
                "sceneFingerprintSha256", "occurredAt",
            },
            "Menu-control history transition",
        )
        for field in ("transitionId", "checkpointId", "undoLockId"):
            self._validated_required_uuid(
                transition[field], f"Menu-control history transition {field}"
            )
        expected_from_status = self._menu_control_history_status(history, from_cursor)
        expected_to_status = self._menu_control_history_status(
            history, transition["toCursor"]
        )
        if (
            transition["checkpointId"] != history["checkpointId"]
            or transition["undoLockId"] != history["undoLockId"]
            or transition["fromCursor"] != from_cursor
            or from_status != expected_from_status
            or transition["status"] != expected_to_status
            or transition["direction"] not in {"undo", "redo"}
        ):
            raise ValueError("Menu-control history transition boundary is invalid")
        to_cursor = transition["toCursor"]
        if history["checkpointKind"] == "failure":
            valid_boundary = (
                transition["direction"] == "undo"
                and from_cursor is None
                and to_cursor == 0
                and transition["stage"] == "baseline"
            ) or (
                transition["direction"] == "redo"
                and from_cursor == 0
                and to_cursor is None
                and transition["stage"] == "failure_checkpoint"
            )
            fingerprint_index = 0 if to_cursor == 0 else 1
        else:
            assert isinstance(from_cursor, int) and isinstance(to_cursor, int)
            delta = -1 if transition["direction"] == "undo" else 1
            valid_boundary = (
                to_cursor - from_cursor == delta
                and transition["stage"]
                == (
                    "baseline", "sphere_created", "location_x", "location_y",
                    "location_z", "scale_x", "scale_y", "scale_z", "renamed_final",
                )[to_cursor]
            )
            fingerprint_index = to_cursor
        if (
            not valid_boundary
            or transition["sceneFingerprintSha256"]
            != history["stageFingerprints"][fingerprint_index]
        ):
            raise ValueError("Menu-control history transition is not adjacent")
        self._menu_control_proof_timestamp(
            transition["occurredAt"], "Menu-control history transition time"
        )
        return transition

    def _validate_current_menu_control_lease(
        self, lease: Any, target: Any, *, label: str
    ) -> dict[str, Any]:
        if not isinstance(lease, dict):
            raise ValueError(f"{label} must be an object")
        self._validate_exact_keys(
            lease,
            {"leaseId", "sessionId", "target", "documentIncarnationId", "expiresAt"},
            label,
        )
        for field in ("leaseId", "sessionId", "documentIncarnationId"):
            self._validated_required_uuid(lease[field], f"{label} {field}")
        session = self._session_snapshot
        if (
            session is None
            or lease["leaseId"] != session.lease_id
            or lease["sessionId"] != session.session_id
            or lease["documentIncarnationId"] != session.document_incarnation_id
            or lease["target"] != target
        ):
            raise ValueError(f"{label} is not the current document lease")
        self._menu_control_proof_timestamp(lease["expiresAt"], f"{label} expiry")
        return lease

    def _validate_menu_control_history_transition_report(
        self, report: Any
    ) -> dict[str, Any]:
        validated = self._validate_menu_control_proof_identity(
            report, "Menu-control history transition report"
        )
        self._validate_exact_keys(
            validated,
            set(self._validate_menu_control_proof_delivery_keys())
            | {
                "kind", "currentLease", "history", "serverAcceptedCursor",
                "serverAcceptedStatus", "transition", "transitionContentSha256",
                "reportedAt",
            },
            "Menu-control history transition report",
        )
        if validated["kind"] != "native_history_transition":
            raise ValueError("Menu-control history transition kind is invalid")
        current_lease = self._validate_current_menu_control_lease(
            validated["currentLease"],
            validated["target"],
            label="Menu-control history transition current lease",
        )
        original_lease = validated["lease"]
        if any(
            current_lease[field] != original_lease[field]
            for field in ("sessionId", "target", "documentIncarnationId")
        ):
            raise ValueError("Menu-control history transition document identity changed")
        history = self._validate_menu_control_history_identity(
            validated["history"], "Menu-control history transition identity"
        )
        transition = self._validate_menu_control_history_transition(
            validated["transition"], history,
            validated["serverAcceptedCursor"], validated["serverAcceptedStatus"],
        )
        if (
            validated["transitionContentSha256"]
            != self._canonical_sha256(transition)
        ):
            raise ValueError("Menu-control history transition commitment is invalid")
        dispatched = self._menu_control_proof_timestamp(
            validated["dispatchedAt"], "Menu-control history original dispatch time"
        )
        occurred = self._menu_control_proof_timestamp(
            transition["occurredAt"], "Menu-control history transition time"
        )
        reported = self._menu_control_proof_timestamp(
            validated["reportedAt"], "Menu-control history report time"
        )
        expires = self._menu_control_proof_timestamp(
            current_lease["expiresAt"], "Menu-control history current lease expiry"
        )
        if not dispatched <= occurred <= reported < expires:
            raise ValueError("Menu-control history transition chronology is invalid")
        return validated

    def _refresh_menu_control_history_transition_lease(
        self, report: dict[str, Any]
    ) -> dict[str, Any]:
        current_lease = self.current_document_lease
        if current_lease is None:
            raise ValueError("Menu-control history transition requires a live lease")
        previous = report.get("currentLease")
        if not isinstance(previous, dict) or any(
            previous.get(field) != current_lease[field]
            for field in ("sessionId", "target", "documentIncarnationId")
        ):
            raise ValueError("Menu-control history transition document identity changed")
        if previous.get("leaseId") == current_lease["leaseId"]:
            return report
        refreshed = deepcopy(report)
        refreshed["currentLease"] = current_lease
        occurred_at = self._menu_control_proof_timestamp(
            refreshed["transition"]["occurredAt"],
            "Menu-control history transition time",
        )
        refreshed["reportedAt"] = max(
            datetime.now(timezone.utc), occurred_at
        ).isoformat().replace("+00:00", "Z")
        return self._validate_menu_control_history_transition_report(refreshed)

    def _validate_menu_control_history_reconciliation_delivery(
        self, delivery: Any
    ) -> dict[str, Any]:
        validated = self._validate_menu_control_proof_identity(
            delivery, "Menu-control history reconciliation"
        )
        self._validate_exact_keys(
            validated,
            set(self._validate_menu_control_proof_delivery_keys())
            | {
                "kind", "recoveryId", "replacementLease", "history",
                "serverAcceptedCursor", "serverAcceptedStatus",
                "acknowledgedTransitionContentSha256s",
                "expectedMarkerContentSha256", "recoveryRequestedAt",
            },
            "Menu-control history reconciliation",
        )
        if validated["kind"] != "native_history_transition_reconcile":
            raise ValueError("Menu-control history reconciliation kind is invalid")
        self._validated_required_uuid(
            validated["recoveryId"], "Menu-control history reconciliation recovery id"
        )
        replacement = self._validate_current_menu_control_lease(
            validated["replacementLease"],
            validated["target"],
            label="Menu-control history reconciliation replacement lease",
        )
        original = validated["lease"]
        if (
            replacement["leaseId"] == original["leaseId"]
            or any(
                replacement[field] != original[field]
                for field in ("sessionId", "target", "documentIncarnationId")
            )
        ):
            raise ValueError("Menu-control history reconciliation lease rotation is invalid")
        terminal_history = validated["history"]
        if not isinstance(terminal_history, dict):
            raise ValueError("Menu-control history reconciliation identity is invalid")
        self._validate_exact_keys(
            terminal_history,
            {
                "checkpointId", "undoLockId", "checkpointKind",
                "baselineSceneFingerprintSha256", "lockedSceneFingerprintSha256",
                "terminalResultContentSha256", "terminalMarkerContentSha256",
            },
            "Menu-control terminal history identity",
        )
        for field in ("checkpointId", "undoLockId"):
            self._validated_required_uuid(
                terminal_history[field], f"Menu-control terminal history {field}"
            )
        if terminal_history["checkpointKind"] not in {"success", "failure"}:
            raise ValueError("Menu-control terminal history checkpoint kind is invalid")
        for field in (
            "baselineSceneFingerprintSha256", "lockedSceneFingerprintSha256",
            "terminalResultContentSha256", "terminalMarkerContentSha256",
        ):
            if (
                not isinstance(terminal_history[field], str)
                or CONTENT_SHA256_PATTERN.fullmatch(terminal_history[field]) is None
            ):
                raise ValueError(f"Menu-control terminal history {field} is invalid")
        cursor = validated["serverAcceptedCursor"]
        synthetic_history = {
            "checkpointKind": terminal_history["checkpointKind"]
        }
        expected_status = self._menu_control_history_status(synthetic_history, cursor)
        hashes = validated["acknowledgedTransitionContentSha256s"]
        if (
            validated["serverAcceptedStatus"] != expected_status
            or not isinstance(hashes, list)
            or len(hashes) > 32
            or len(set(hashes)) != len(hashes)
            or any(
                not isinstance(value, str)
                or CONTENT_SHA256_PATTERN.fullmatch(value) is None
                for value in hashes
            )
            or validated["expectedMarkerContentSha256"]
            != terminal_history["terminalMarkerContentSha256"]
        ):
            raise ValueError("Menu-control history reconciliation boundary is invalid")
        requested = self._menu_control_proof_timestamp(
            validated["recoveryRequestedAt"],
            "Menu-control history reconciliation request time",
        )
        dispatched = self._menu_control_proof_timestamp(
            validated["dispatchedAt"], "Menu-control history original dispatch time"
        )
        expires = self._menu_control_proof_timestamp(
            replacement["expiresAt"],
            "Menu-control history replacement lease expiry",
        )
        if not dispatched <= requested < expires:
            raise ValueError("Menu-control history reconciliation chronology is invalid")
        return validated

    def _validate_menu_control_history_reconciliation_ack(
        self, ack: Any
    ) -> dict[str, Any]:
        validated = self._validate_menu_control_proof_identity(
            ack, "Menu-control history reconciliation acknowledgement"
        )
        self._validate_exact_keys(
            validated,
            set(self._validate_menu_control_proof_delivery_keys())
            | {
                "kind", "recoveryId", "history", "serverAcceptedCursor",
                "serverAcceptedStatus", "transitions", "transitionContentSha256s",
                "terminalResultContentSha256", "expectedMarkerContentSha256",
                "currentCursor", "currentStatus",
                "currentSceneFingerprintSha256", "occurredAt",
            },
            "Menu-control history reconciliation acknowledgement",
        )
        if validated["kind"] != "native_history_transition_reconcile":
            raise ValueError("Menu-control history reconciliation acknowledgement kind is invalid")
        recovery_id = self._validated_required_uuid(
            validated["recoveryId"],
            "Menu-control history reconciliation acknowledgement recovery id",
        )
        challenge = self._menu_control_proof_reconciliations.get(recovery_id)
        if challenge is None or challenge.get("kind") != "native_history_transition_reconcile":
            raise ValueError("Menu-control history reconciliation challenge is not active")
        if any(
            validated[key] != challenge[key]
            for key in self._validate_menu_control_proof_delivery_keys()
        ):
            raise ValueError("Menu-control history reconciliation delivery identity changed")
        history = self._validate_menu_control_history_identity(
            validated["history"], "Menu-control history reconciliation identity"
        )
        terminal_history = challenge["history"]
        locked_index = 8 if history["checkpointKind"] == "success" else 1
        if (
            history["checkpointId"] != terminal_history["checkpointId"]
            or history["undoLockId"] != terminal_history["undoLockId"]
            or history["checkpointKind"] != terminal_history["checkpointKind"]
            or history["stageFingerprints"][0]
            != terminal_history["baselineSceneFingerprintSha256"]
            or history["stageFingerprints"][locked_index]
            != terminal_history["lockedSceneFingerprintSha256"]
            or history["terminalResultContentSha256"]
            != terminal_history["terminalResultContentSha256"]
            or history["terminalMarkerContentSha256"]
            != terminal_history["terminalMarkerContentSha256"]
        ):
            raise ValueError("Menu-control history reconciliation checkpoint changed")
        transitions = validated["transitions"]
        hashes = validated["transitionContentSha256s"]
        if (
            not isinstance(transitions, list)
            or len(transitions) > 32
            or not isinstance(hashes, list)
            or len(hashes) != len(transitions)
        ):
            raise ValueError("Menu-control history reconciliation batch is invalid")
        cursor = validated["serverAcceptedCursor"]
        status = validated["serverAcceptedStatus"]
        previous_time: datetime | None = None
        for transition, content_sha256 in zip(transitions, hashes):
            self._validate_menu_control_history_transition(
                transition, history, cursor, status
            )
            if content_sha256 != self._canonical_sha256(transition):
                raise ValueError("Menu-control history reconciliation transition hash changed")
            occurred = self._menu_control_proof_timestamp(
                transition["occurredAt"], "Menu-control history transition time"
            )
            if previous_time is not None and occurred <= previous_time:
                raise ValueError("Menu-control history reconciliation chronology is invalid")
            previous_time = occurred
            cursor = transition["toCursor"]
            status = transition["status"]
        fingerprint_index = 1 if cursor is None else cursor
        for field in (
            "terminalResultContentSha256", "expectedMarkerContentSha256",
            "currentSceneFingerprintSha256",
        ):
            if (
                not isinstance(validated[field], str)
                or CONTENT_SHA256_PATTERN.fullmatch(validated[field]) is None
            ):
                raise ValueError(f"Menu-control history reconciliation {field} is invalid")
        occurred_at = self._menu_control_proof_timestamp(
            validated["occurredAt"],
            "Menu-control history reconciliation acknowledgement time",
        )
        if (
            validated["serverAcceptedCursor"] != challenge["serverAcceptedCursor"]
            or validated["serverAcceptedStatus"] != challenge["serverAcceptedStatus"]
            or validated["terminalResultContentSha256"]
            != history["terminalResultContentSha256"]
            or validated["expectedMarkerContentSha256"]
            != challenge["expectedMarkerContentSha256"]
            or validated["currentCursor"] != cursor
            or validated["currentStatus"] != status
            or validated["currentSceneFingerprintSha256"]
            != history["stageFingerprints"][fingerprint_index]
            or occurred_at
            < self._menu_control_proof_timestamp(
                challenge["recoveryRequestedAt"],
                "Menu-control history reconciliation request time",
            )
            or previous_time is not None and occurred_at < previous_time
        ):
            raise ValueError("Menu-control history reconciliation evidence is invalid")
        return validated

    def _validate_menu_control_terminal_reconciliation_ack(
        self, ack: Any
    ) -> dict[str, Any]:
        if not isinstance(ack, dict):
            raise ValueError("Menu-control reconciliation acknowledgement must be an object")
        if ack.get("kind") == "native_history_transition_reconcile":
            return self._validate_menu_control_history_reconciliation_ack(ack)
        self._validate_exact_keys(
            ack,
            {
                "kind",
                "recoveryId",
                "result",
                "terminalResultContentSha256",
                "expectedMarkerContentSha256",
                "currentSceneFingerprintSha256",
                "occurredAt",
            },
            "Menu-control reconciliation acknowledgement",
        )
        if ack["kind"] != "native_terminal_reconcile":
            raise ValueError("Menu-control reconciliation acknowledgement kind is invalid")
        self._validated_required_uuid(
            ack["recoveryId"], "Menu-control reconciliation acknowledgement recovery id"
        )
        challenge = self._menu_control_proof_reconciliations.get(ack["recoveryId"])
        if challenge is None:
            raise ValueError("Menu-control reconciliation challenge is not active")
        result = self._validate_menu_control_proof_result(ack["result"])
        if result["status"] not in {"succeeded", "failed_checkpointed"}:
            raise ValueError("Menu-control reconciliation requires a locked terminal result")
        if any(
            result[key] != challenge[key]
            for key in self._validate_menu_control_proof_delivery_keys()
        ):
            raise ValueError("Menu-control reconciliation changed immutable delivery identity")
        terminal = result["terminalEvidence"]
        receipts = (
            terminal["operationReceipts"]
            if result["status"] == "succeeded"
            else terminal["receiptPrefix"]
        )
        terminal_heads = [receipt["contentSha256"] for receipt in receipts]
        acknowledged_heads = challenge["acknowledgedProgressReceiptChainHeads"]
        expected_fingerprint = (
            terminal["nativeUndoCheckpoint"]["finalSceneFingerprintSha256"]
            if result["status"] == "succeeded"
            else terminal["checkpoint"]["currentSceneFingerprintSha256"]
        )
        checkpoint = (
            terminal["nativeUndoCheckpoint"]
            if result["status"] == "succeeded"
            else terminal["checkpoint"]
        )
        terminal_marker_identity = {
            "formatVersion": "1.0.0",
            "executorId": result["executorId"],
            "checkpointId": checkpoint["checkpointId"],
            "undoLockId": checkpoint["undoLockId"],
            "proofId": result["proofId"],
            "replayId": result["replayId"],
            "targetId": result["binding"]["acceptedAction"]["arguments"][
                "resourceId"
            ],
            "checkpointKind": (
                "success" if result["status"] == "succeeded" else "failure"
            ),
            "baselineSceneFingerprintSha256": checkpoint[
                "baselineSceneFingerprintSha256"
            ],
            "lockedSceneFingerprintSha256": expected_fingerprint,
            "terminalResultContentSha256": self._canonical_sha256(result),
        }
        occurred_at = self._menu_control_proof_timestamp(
            ack["occurredAt"], "Menu-control reconciliation acknowledgement time"
        )
        if (
            terminal_heads[: len(acknowledged_heads)] != acknowledged_heads
            or ack["terminalResultContentSha256"] != self._canonical_sha256(result)
            or ack["expectedMarkerContentSha256"]
            != self._canonical_sha256(terminal_marker_identity)
            or ack["currentSceneFingerprintSha256"] != expected_fingerprint
            or occurred_at
            < self._menu_control_proof_timestamp(
                challenge["recoveryRequestedAt"],
                "Menu-control reconciliation request time",
            )
        ):
            raise ValueError("Menu-control reconciliation acknowledgement evidence is invalid")
        return ack

    def _poll_menu_control_proof_request(self) -> None:
        response = self._request_json(
            "GET",
            "/api/v1/companion/menu-control-proof?" + urlencode({"adapterId": "blender", "instanceId": self._instance_id}),
            abort_on_stop=True,
        )
        self._validate_exact_keys(response, {"request"}, "Menu-control proof poll")
        delivery = response["request"]
        session = self._session_snapshot
        if session is None:
            raise ValueError("Menu-control proof poll requires a live lease")
        first_discovery_for_lease = (
            self._menu_control_recovery_discovery_lease_id != session.lease_id
        )
        if delivery is None:
            if first_discovery_for_lease:
                self._menu_control_recovery_discovery_lease_id = session.lease_id
                self._release_menu_control_recovery_barrier(session.lease_id)
                self.incoming.put(
                    {
                        "kind": "menu_control_proof_recovery_absent",
                        "leaseId": session.lease_id,
                    }
                )
            return
        if (
            isinstance(delivery, dict)
            and delivery.get("kind") == "native_history_transition_reconcile"
        ):
            validated_recovery = (
                self._validate_menu_control_history_reconciliation_delivery(delivery)
            )
            self._menu_control_recovery_discovery_lease_id = session.lease_id
            self._acknowledge_reconciled_menu_control_history_transitions(
                validated_recovery["acknowledgedTransitionContentSha256s"]
            )
            recovery_id = validated_recovery["recoveryId"]
            if recovery_id in self._seen_menu_control_proof_recovery_ids:
                return
            if len(self._seen_menu_control_proof_recovery_ids) >= 256:
                expired = self._seen_menu_control_proof_recovery_ids.pop()
                self._menu_control_proof_reconciliations.pop(expired, None)
            self._seen_menu_control_proof_recovery_ids.add(recovery_id)
            self._menu_control_proof_reconciliations[recovery_id] = dict(
                validated_recovery
            )
            self.incoming.put(
                {
                    "kind": "menu_control_proof_history_reconcile_request",
                    "request": dict(validated_recovery),
                }
            )
            return
        if isinstance(delivery, dict) and delivery.get("kind") == "native_terminal_reconcile":
            validated_recovery = self._validate_menu_control_terminal_reconciliation_delivery(
                delivery
            )
            self._menu_control_recovery_discovery_lease_id = session.lease_id
            recovery_id = validated_recovery["recoveryId"]
            if recovery_id in self._seen_menu_control_proof_recovery_ids:
                return
            if len(self._seen_menu_control_proof_recovery_ids) >= 256:
                expired = self._seen_menu_control_proof_recovery_ids.pop()
                self._menu_control_proof_reconciliations.pop(expired, None)
            self._seen_menu_control_proof_recovery_ids.add(recovery_id)
            self._menu_control_proof_reconciliations[recovery_id] = dict(
                validated_recovery
            )
            self.incoming.put(
                {
                    "kind": "menu_control_proof_terminal_reconcile_request",
                    "request": dict(validated_recovery),
                }
            )
            return
        validated = self._validate_menu_control_proof_delivery(delivery)
        if first_discovery_for_lease:
            self._menu_control_recovery_discovery_lease_id = session.lease_id
            self._release_menu_control_recovery_barrier(session.lease_id)
            self.incoming.put(
                {
                    "kind": "menu_control_proof_recovery_absent",
                    "leaseId": session.lease_id,
                }
            )
        request_id = validated["requestId"]
        if request_id in self._seen_menu_control_proof_request_ids:
            return
        if self._menu_control_proof_inflight_request_id not in {None, request_id}:
            raise ValueError("A different menu-control proof is already in flight")
        if len(self._seen_menu_control_proof_request_ids) >= 256:
            self._seen_menu_control_proof_request_ids.pop()
        self._seen_menu_control_proof_request_ids.add(request_id)
        self._menu_control_proof_inflight_request_id = request_id
        message = {"kind": "menu_control_proof_execute_request", "request": dict(validated)}
        self.incoming.put(message)

    def _validate_edit_subdivide_shortcut_binding(self, binding: Any) -> dict[str, Any]:
        if not isinstance(binding, dict):
            raise ValueError("Edit Subdivide shortcut binding must be an object")
        self._validate_exact_keys(
            binding,
            {
                "formatVersion", "bindingId", "proposalRecordContentSha256", "proofId",
                "requestId", "replayId", "target", "proposalId", "plan", "executionId",
                "leafId", "recipeId", "actionName", "acceptedAction", "targetProfile",
                "acceptedDecision", "proofScope", "materialization", "executorId",
                "executionBoundary", "authorization", "transport", "operationIds",
                "nativeUndoDepth", "nativeRedoDepth", "startState", "createdAt", "integrity",
            },
            "Edit Subdivide shortcut binding",
        )
        if binding["formatVersion"] != "1.0.0":
            raise ValueError("Edit Subdivide shortcut binding format is unsupported")
        for field in ("bindingId", "proofId", "requestId", "replayId", "proposalId", "executionId"):
            self._validated_required_uuid(binding[field], f"Edit Subdivide binding {field}")
        target = binding["target"]
        if target != {"adapterId": "blender", "instanceId": self._instance_id}:
            raise ValueError("Edit Subdivide shortcut binding targets a different Companion")
        action = binding["acceptedAction"]
        if not isinstance(action, dict):
            raise ValueError("Edit Subdivide accepted action must be an object")
        self._validate_exact_keys(action, {"adapterId", "name", "arguments"}, "Edit Subdivide accepted action")
        arguments = action.get("arguments")
        if not isinstance(arguments, dict):
            raise ValueError("Edit Subdivide accepted arguments must be an object")
        self._validate_exact_keys(arguments, {"targetId", "resultMeshId", "resultMeshName", "cuts", "smooth"}, "Edit Subdivide accepted arguments")
        if (
            action.get("adapterId") != "blender"
            or action.get("name") != "blender.mesh.edit_subdivide"
            or binding["recipeId"] != "blender.mesh.edit_subdivide.semantic"
            or binding["actionName"] != "blender.mesh.edit_subdivide"
            or arguments["targetId"] != "tutorial.cube"
            or any(not isinstance(arguments[field], str) or not arguments[field] for field in ("resultMeshId", "resultMeshName"))
            or isinstance(arguments["cuts"], bool)
            or not isinstance(arguments["cuts"], int)
            or not 1 <= arguments["cuts"] <= 8
            or isinstance(arguments["smooth"], bool)
            or not isinstance(arguments["smooth"], (int, float))
            or not 0 <= arguments["smooth"] <= 1
        ):
            raise ValueError("Edit Subdivide accepted action is invalid")
        if binding["targetProfile"] != "factory_cube_single_user_mesh_8_12_6":
            raise ValueError("Edit Subdivide target profile is unsupported")
        if binding["proofScope"] != {
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "managedReceiptCreated": False,
            "managedReplacementMeshCreated": False,
            "nativeMutationKind": "in_place_edit_mesh_subdivide",
            "omittedAcceptedArguments": ["targetId", "resultMeshId", "resultMeshName"],
        }:
            raise ValueError("Edit Subdivide proof scope is invalid")
        if (
            binding["executorId"] != EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID
            or binding["executionBoundary"] != "blender_window_event_simulate"
            or binding["authorization"] != "accepted_replay_next_step"
            or binding["transport"] != "event_simulate"
            or binding["operationIds"] != EDIT_SUBDIVIDE_SHORTCUT_OPERATION_IDS
            or binding["nativeUndoDepth"] != 4
            or binding["nativeRedoDepth"] != 4
        ):
            raise ValueError("Edit Subdivide executor authority is invalid")
        decision = binding["acceptedDecision"]
        if not isinstance(decision, dict):
            raise ValueError("Edit Subdivide accepted decision must be an object")
        self._validate_exact_keys(
            decision,
            {"decisionId", "proposalId", "instanceId", "adapterId", "decision", "decidedAt"},
            "Edit Subdivide accepted decision",
        )
        if decision.get("proposalId") != binding["proposalId"] or decision.get("instanceId") != self._instance_id or decision.get("adapterId") != "blender" or decision.get("decision") != "accepted":
            raise ValueError("Edit Subdivide accepted decision is invalid")
        self._validated_required_uuid(decision.get("decisionId"), "Edit Subdivide decision id")
        self._validate_expiry(decision.get("decidedAt"), "Edit Subdivide decision time")
        for nested, keys, label in (
            (binding["plan"], {"id", "revision", "contentSha256"}, "plan"),
            (binding["startState"], {"reportId", "sequence"}, "start state"),
            (binding["materialization"], {"actionCatalogVersion", "interactionCatalogVersion", "interactionCatalogContentSha256", "shortcutTrackContentSha256"}, "materialization"),
            (binding["integrity"], {"algorithm", "canonicalization", "contentSha256"}, "integrity"),
        ):
            if not isinstance(nested, dict):
                raise ValueError(f"Edit Subdivide binding {label} must be an object")
            self._validate_exact_keys(nested, keys, f"Edit Subdivide binding {label}")
        plan = binding["plan"]
        if not isinstance(plan["id"], str) or not plan["id"] or isinstance(plan["revision"], bool) or not isinstance(plan["revision"], int) or plan["revision"] <= 0 or CONTENT_SHA256_PATTERN.fullmatch(str(plan["contentSha256"])) is None:
            raise ValueError("Edit Subdivide binding plan is invalid")
        self._validated_required_uuid(binding["startState"]["reportId"], "Edit Subdivide start report id")
        if isinstance(binding["startState"]["sequence"], bool) or not isinstance(binding["startState"]["sequence"], int) or binding["startState"]["sequence"] <= 0:
            raise ValueError("Edit Subdivide start sequence must be positive")
        for field in ("proposalRecordContentSha256",):
            if CONTENT_SHA256_PATTERN.fullmatch(str(binding[field])) is None:
                raise ValueError(f"Edit Subdivide binding {field} is invalid")
        for field in ("interactionCatalogContentSha256", "shortcutTrackContentSha256"):
            if CONTENT_SHA256_PATTERN.fullmatch(str(binding["materialization"][field])) is None:
                raise ValueError(f"Edit Subdivide materialization {field} is invalid")
        integrity = binding["integrity"]
        if integrity.get("algorithm") != "sha256" or integrity.get("canonicalization") != "operatingline-json-value-v1" or integrity.get("contentSha256") != self._canonical_sha256({key: value for key, value in binding.items() if key != "integrity"}):
            raise ValueError("Edit Subdivide binding content hash does not match")
        self._validate_expiry(binding["createdAt"], "Edit Subdivide binding creation time")
        return binding

    def _validate_shortcut_proof_binding(self, binding: Any) -> dict[str, Any]:
        if isinstance(binding, dict) and binding.get("executorId") == EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID:
            return self._validate_edit_subdivide_shortcut_binding(binding)
        if not isinstance(binding, dict):
            raise ValueError("Shortcut proof binding must be an object")
        self._validate_exact_keys(
            binding,
            {
                "formatVersion", "bindingId", "proposalRecordContentSha256",
                "proofId", "requestId", "replayId", "target", "proposalId",
                "plan", "executionId", "leafId", "recipeId", "actionName",
                "acceptedAction", "targetProfile", "acceptedDecision", "proofScope",
                "materialization", "executorId", "executionBoundary", "authorization",
                "transport", "operationIds", "startState", "createdAt", "integrity",
            },
            "Shortcut proof binding",
        )
        if binding["formatVersion"] != "1.0.0":
            raise ValueError("Unsupported shortcut proof binding format version")
        for field in (
            "bindingId", "proofId", "requestId", "replayId", "proposalId", "executionId"
        ):
            self._validated_required_uuid(binding[field], f"Shortcut proof binding {field}")
        for field in ("proposalRecordContentSha256",):
            if not isinstance(binding[field], str) or CONTENT_SHA256_PATTERN.fullmatch(binding[field]) is None:
                raise ValueError(f"Shortcut proof binding {field} is invalid")
        target = binding["target"]
        if not isinstance(target, dict):
            raise ValueError("Shortcut proof binding target must be an object")
        self._validate_exact_keys(target, {"adapterId", "instanceId"}, "Shortcut proof binding target")
        if target != {"adapterId": "blender", "instanceId": self._instance_id}:
            raise ValueError("Shortcut proof binding targets a different Blender instance")
        self._validated_required_uuid(target["instanceId"], "Shortcut proof binding instance id")
        plan = binding["plan"]
        if not isinstance(plan, dict):
            raise ValueError("Shortcut proof binding plan must be an object")
        self._validate_exact_keys(plan, {"id", "revision", "contentSha256"}, "Shortcut proof binding plan")
        if not isinstance(plan["id"], str) or not plan["id"]:
            raise ValueError("Shortcut proof binding plan id must not be empty")
        if isinstance(plan["revision"], bool) or not isinstance(plan["revision"], int) or plan["revision"] <= 0:
            raise ValueError("Shortcut proof binding plan revision must be positive")
        if not isinstance(plan["contentSha256"], str) or CONTENT_SHA256_PATTERN.fullmatch(plan["contentSha256"]) is None:
            raise ValueError("Shortcut proof binding plan hash is invalid")
        if binding["recipeId"] != "blender.modifier.add_subdivision_surface.semantic" or binding["actionName"] != "blender.modifier.add_subdivision_surface":
            raise ValueError("Shortcut proof binding is restricted to Subdivision Surface")
        action = binding["acceptedAction"]
        if not isinstance(action, dict):
            raise ValueError("Shortcut proof accepted action must be an object")
        self._validate_exact_keys(action, {"adapterId", "name", "arguments"}, "Shortcut proof accepted action")
        arguments = action.get("arguments")
        if action.get("adapterId") != "blender" or action.get("name") != binding["actionName"] or not isinstance(arguments, dict):
            raise ValueError("Shortcut proof accepted action is invalid")
        self._validate_exact_keys(arguments, {"targetId", "modifierId", "modifierName", "viewportLevel"}, "Shortcut proof accepted arguments")
        if (
            arguments["targetId"] != "tutorial.cube"
            or arguments["modifierId"] != "tutorial.cube.subdivision_surface"
            or arguments["modifierName"] != "OperatingLine.Cube.SubdivisionSurface"
        ):
            raise ValueError("Shortcut proof accepted resource identity is invalid")
        if isinstance(arguments["viewportLevel"], bool) or arguments["viewportLevel"] not in {1, 2, 3}:
            raise ValueError("Shortcut proof viewport level must be 1, 2, or 3")
        if binding["targetProfile"] != "factory_cube_8_12_6":
            raise ValueError("Shortcut proof target profile is unsupported")
        decision = binding["acceptedDecision"]
        if not isinstance(decision, dict):
            raise ValueError("Shortcut proof accepted decision must be an object")
        self._validate_exact_keys(decision, {"decisionId", "proposalId", "instanceId", "adapterId", "decision", "decidedAt"}, "Shortcut proof accepted decision")
        for field in ("decisionId", "proposalId", "instanceId"):
            self._validated_required_uuid(decision[field], f"Shortcut proof decision {field}")
        if decision["proposalId"] != binding["proposalId"] or decision["instanceId"] != self._instance_id or decision["adapterId"] != "blender" or decision["decision"] != "accepted":
            raise ValueError("Shortcut proof decision does not bind the accepted proposal")
        self._validate_expiry(decision["decidedAt"], "Shortcut proof decision time")
        proof_scope = binding["proofScope"]
        if proof_scope != {
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "managedReceiptCreated": False,
            "omittedAcceptedArguments": ["modifierId", "modifierName"],
        }:
            raise ValueError("Shortcut proof managed-action scope is invalid")
        materialization = binding["materialization"]
        if not isinstance(materialization, dict):
            raise ValueError("Shortcut proof materialization must be an object")
        self._validate_exact_keys(materialization, {"actionCatalogVersion", "interactionCatalogVersion", "interactionCatalogContentSha256", "shortcutTrackContentSha256"}, "Shortcut proof materialization")
        for field in ("interactionCatalogContentSha256", "shortcutTrackContentSha256"):
            if not isinstance(materialization[field], str) or CONTENT_SHA256_PATTERN.fullmatch(materialization[field]) is None:
                raise ValueError(f"Shortcut proof materialization {field} is invalid")
        operations = list(binding["operationIds"]) if isinstance(binding["operationIds"], list) else None
        expected_operations = [
            "shortcut.add_subdivision_surface_level_one",
            "shortcut.open_adjust_last_operation",
            "shortcut.set_viewport_level",
            "shortcut.close_adjust_last_operation",
        ]
        if (
            binding["executorId"] != "blender.subdivision_surface_f9.event_simulate.v1"
            or binding["executionBoundary"] != "blender_window_event_simulate"
            or binding["authorization"] != "accepted_replay_next_step"
            or binding["transport"] != "event_simulate"
            or operations != expected_operations
        ):
            raise ValueError("Shortcut proof executor authority is invalid")
        start_state = binding["startState"]
        if not isinstance(start_state, dict):
            raise ValueError("Shortcut proof start state must be an object")
        self._validate_exact_keys(start_state, {"reportId", "sequence"}, "Shortcut proof start state")
        self._validated_required_uuid(start_state["reportId"], "Shortcut proof start report id")
        if isinstance(start_state["sequence"], bool) or not isinstance(start_state["sequence"], int) or start_state["sequence"] <= 0:
            raise ValueError("Shortcut proof start sequence must be positive")
        self._validate_expiry(binding["createdAt"], "Shortcut proof binding creation time")
        integrity = binding["integrity"]
        if not isinstance(integrity, dict):
            raise ValueError("Shortcut proof binding integrity must be an object")
        self._validate_exact_keys(integrity, {"algorithm", "canonicalization", "contentSha256"}, "Shortcut proof binding integrity")
        if integrity.get("algorithm") != "sha256" or integrity.get("canonicalization") != "operatingline-json-value-v1":
            raise ValueError("Shortcut proof binding integrity algorithm is unsupported")
        content = {key: value for key, value in binding.items() if key != "integrity"}
        if integrity.get("contentSha256") != self._canonical_sha256(content):
            raise ValueError("Shortcut proof binding content hash does not match")
        return binding

    def _validate_edit_subdivide_shortcut_identity(self, payload: Any, label: str, *, terminal: bool = False) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError(f"{label} must be an object")
        base = {
            "formatVersion", "requestId", "replayId", "proofId", "deliveryId", "target",
            "targetProfile", "proposalId", "plan", "executionId", "leafId",
            "interactionCatalogVersion", "interactionCatalogContentSha256",
            "shortcutTrackContentSha256", "bindingContentSha256", "binding", "executorId",
            "executionBoundary", "authorization", "transport", "operationIds", "nativeUndoDepth",
            "nativeRedoDepth", "expectedState", "requestedAt", "dispatchedAt",
        }
        extra = (
            {"status", "managedActionResult", "managedIdentityVerified", "managedReceiptCreated", "managedReplacementMeshCreated", "nativeMutationKind", "requiresUndoToUnlock", "terminalEvidence", "error", "occurredAt"}
            if terminal
            else {"status", "completedOperationIds", "receiptChainHeadSha256", "occurredAt"}
        )
        self._validate_exact_keys(payload, base | extra, label)
        binding = self._validate_edit_subdivide_shortcut_binding(payload["binding"])
        if (
            payload["formatVersion"] != "1.0.0"
            or payload["target"] != {"adapterId": "blender", "instanceId": self._instance_id}
            or payload["targetProfile"] != "factory_cube_single_user_mesh_8_12_6"
            or payload["executorId"] != EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID
            or payload["executionBoundary"] != "blender_window_event_simulate"
            or payload["authorization"] != "accepted_replay_next_step"
            or payload["transport"] != "event_simulate"
            or payload["operationIds"] != EDIT_SUBDIVIDE_SHORTCUT_OPERATION_IDS
            or payload["nativeUndoDepth"] != 4
            or payload["nativeRedoDepth"] != 4
        ):
            raise ValueError(f"{label} executor identity is invalid")
        for field in ("requestId", "replayId", "proofId", "deliveryId", "proposalId", "executionId"):
            self._validated_required_uuid(payload[field], f"{label} {field}")
        mirror_fields = ("requestId", "replayId", "proofId", "target", "targetProfile", "proposalId", "plan", "executionId", "leafId", "executorId", "executionBoundary", "authorization", "transport", "operationIds", "nativeUndoDepth", "nativeRedoDepth")
        if any(binding[field] != payload[field] for field in mirror_fields):
            raise ValueError(f"{label} does not mirror its immutable binding")
        materialization = binding["materialization"]
        if (
            payload["bindingContentSha256"] != binding["integrity"]["contentSha256"]
            or payload["expectedState"] != binding["startState"]
            or payload["interactionCatalogVersion"] != materialization["interactionCatalogVersion"]
            or payload["interactionCatalogContentSha256"] != materialization["interactionCatalogContentSha256"]
            or payload["shortcutTrackContentSha256"] != materialization["shortcutTrackContentSha256"]
        ):
            raise ValueError(f"{label} immutable delivery identity is inconsistent")
        for field in ("requestedAt", "dispatchedAt", "occurredAt"):
            self._validate_expiry(payload[field], f"{label} {field}")
        return payload

    def _validate_shortcut_proof_identity(self, payload: Any, label: str, *, terminal: bool = False) -> dict[str, Any]:
        if isinstance(payload, dict) and payload.get("executorId") == EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID:
            return self._validate_edit_subdivide_shortcut_identity(payload, label, terminal=terminal)
        if not isinstance(payload, dict):
            raise ValueError(f"{label} must be an object")
        identity_keys = {
            "formatVersion", "requestId", "replayId", "proofId", "deliveryId",
            "target", "targetProfile", "proposalId", "plan", "executionId", "leafId",
            "interactionCatalogVersion", "interactionCatalogContentSha256",
            "shortcutTrackContentSha256", "bindingContentSha256", "binding", "executorId",
            "executionBoundary", "authorization", "transport", "operationIds",
            "expectedState", "requestedAt", "dispatchedAt",
        }
        extra = {"status", "managedActionResult", "managedIdentityVerified", "requiresUndoToUnlock", "terminalEvidence", "error", "occurredAt"} if terminal else {"status", "completedOperationIds", "receiptChainHeadSha256", "occurredAt"}
        self._validate_exact_keys(payload, identity_keys | extra, label)
        binding = self._validate_shortcut_proof_binding(payload["binding"])
        if payload["formatVersion"] != "1.0.0":
            raise ValueError(f"{label} format version is unsupported")
        for field in ("requestId", "replayId", "proofId", "deliveryId", "proposalId", "executionId"):
            self._validated_required_uuid(payload[field], f"{label} {field}")
        target = payload["target"]
        if target != {"adapterId": "blender", "instanceId": self._instance_id}:
            raise ValueError(f"{label} targets a different Companion")
        if payload["targetProfile"] != "factory_cube_8_12_6":
            raise ValueError(f"{label} target profile is unsupported")
        plan = payload["plan"]
        if not isinstance(plan, dict):
            raise ValueError(f"{label} plan must be an object")
        self._validate_exact_keys(plan, {"id", "revision", "contentSha256"}, f"{label} plan")
        for field in ("interactionCatalogContentSha256", "shortcutTrackContentSha256", "bindingContentSha256"):
            if not isinstance(payload[field], str) or CONTENT_SHA256_PATTERN.fullmatch(payload[field]) is None:
                raise ValueError(f"{label} {field} is invalid")
        expected_state = payload["expectedState"]
        if not isinstance(expected_state, dict):
            raise ValueError(f"{label} expected state must be an object")
        self._validate_exact_keys(expected_state, {"reportId", "sequence"}, f"{label} expected state")
        self._validated_required_uuid(expected_state["reportId"], f"{label} expected report id")
        expected_operations = [
            "shortcut.add_subdivision_surface_level_one",
            "shortcut.open_adjust_last_operation",
            "shortcut.set_viewport_level",
            "shortcut.close_adjust_last_operation",
        ]
        mirror = {
            "requestId": "requestId", "replayId": "replayId", "proofId": "proofId",
            "proposalId": "proposalId", "executionId": "executionId", "leafId": "leafId",
            "targetProfile": "targetProfile", "executorId": "executorId",
            "executionBoundary": "executionBoundary", "authorization": "authorization",
            "transport": "transport", "operationIds": "operationIds",
        }
        if any(binding[binding_field] != payload[payload_field] for payload_field, binding_field in mirror.items()):
            raise ValueError(f"{label} does not mirror its immutable binding")
        materialization = binding["materialization"]
        if (
            payload["bindingContentSha256"] != binding["integrity"]["contentSha256"]
            or payload["target"] != binding["target"]
            or payload["plan"] != binding["plan"]
            or payload["expectedState"] != binding["startState"]
            or payload["interactionCatalogVersion"] != materialization["interactionCatalogVersion"]
            or payload["interactionCatalogContentSha256"] != materialization["interactionCatalogContentSha256"]
            or payload["shortcutTrackContentSha256"] != materialization["shortcutTrackContentSha256"]
            or payload["operationIds"] != expected_operations
        ):
            raise ValueError(f"{label} immutable delivery identity is inconsistent")
        self._validate_expiry(payload["requestedAt"], f"{label} requested time")
        self._validate_expiry(payload["dispatchedAt"], f"{label} dispatched time")
        self._validate_expiry(payload["occurredAt"], f"{label} occurrence time")
        return payload

    def _validate_shortcut_proof_delivery(self, delivery: Any) -> dict[str, Any]:
        if not isinstance(delivery, dict):
            raise ValueError("Shortcut proof delivery must be an object")
        synthetic = dict(delivery)
        synthetic.update({"status": "in_progress", "completedOperationIds": [delivery.get("operationIds", [None])[0]], "receiptChainHeadSha256": "0" * 64, "occurredAt": delivery.get("dispatchedAt")})
        self._validate_shortcut_proof_identity(synthetic, "Shortcut proof delivery")
        return delivery

    def _validate_shortcut_proof_history_identity(self, history: Any) -> dict[str, Any]:
        if not isinstance(history, dict):
            raise ValueError("Shortcut proof history identity must be an object")
        self._validate_exact_keys(
            history,
            {
                "checkpointId", "undoLockId", "checkpointKind",
                "baselineSceneFingerprintSha256", "lockedSceneFingerprintSha256",
                "terminalResultContentSha256",
            },
            "Shortcut proof history identity",
        )
        self._validated_required_uuid(history["checkpointId"], "Shortcut proof checkpoint id")
        self._validated_required_uuid(history["undoLockId"], "Shortcut proof Undo lock id")
        if history["checkpointKind"] not in {"success", "failure"}:
            raise ValueError("Shortcut proof checkpoint kind is invalid")
        for field in (
            "baselineSceneFingerprintSha256",
            "lockedSceneFingerprintSha256",
            "terminalResultContentSha256",
        ):
            if not isinstance(history[field], str) or CONTENT_SHA256_PATTERN.fullmatch(history[field]) is None:
                raise ValueError(f"Shortcut proof history {field} is invalid")
        return history

    def _validate_shortcut_proof_recovery_delivery(self, delivery: Any) -> dict[str, Any]:
        if not isinstance(delivery, dict):
            raise ValueError("Shortcut proof recovery delivery must be an object")
        recovery_keys = {
            "kind", "recoveryId", "history", "expectedMarkerContentSha256",
            "expectedResultContentSha256", "expectedStatus", "recoveryRequestedAt",
        }
        base = {key: value for key, value in delivery.items() if key not in recovery_keys}
        self._validate_shortcut_proof_delivery(base)
        self._validate_exact_keys(
            delivery,
            set(base) | recovery_keys,
            "Shortcut proof recovery delivery",
        )
        if delivery["kind"] != "native_history_rebind":
            raise ValueError("Shortcut proof recovery kind is unsupported")
        self._validated_required_uuid(delivery["recoveryId"], "Shortcut proof recovery id")
        self._validate_shortcut_proof_history_identity(delivery["history"])
        if delivery["expectedStatus"] not in {
            "succeeded", "failed_checkpointed", "restored", "reapplied_locked"
        }:
            raise ValueError("Shortcut proof recovery expected status is invalid")
        marker_hash = delivery["expectedMarkerContentSha256"]
        if not isinstance(marker_hash, str) or CONTENT_SHA256_PATTERN.fullmatch(marker_hash) is None:
            raise ValueError("Shortcut proof recovery marker hash is invalid")
        result_hash = delivery["expectedResultContentSha256"]
        if (
            not isinstance(result_hash, str)
            or CONTENT_SHA256_PATTERN.fullmatch(result_hash) is None
        ):
            raise ValueError("Shortcut proof recovery expected result hash is invalid")
        self._validate_expiry(delivery["recoveryRequestedAt"], "Shortcut proof recovery request time")
        recovery_requested_at = datetime.fromisoformat(
            delivery["recoveryRequestedAt"].replace("Z", "+00:00")
        )
        dispatched_at = datetime.fromisoformat(
            delivery["dispatchedAt"].replace("Z", "+00:00")
        )
        if recovery_requested_at < dispatched_at:
            raise ValueError("Shortcut proof recovery predates the original delivery")
        return delivery

    def _validate_shortcut_terminal_reconcile_delivery(
        self, delivery: Any
    ) -> dict[str, Any]:
        if not isinstance(delivery, dict):
            raise ValueError("Shortcut terminal reconciliation delivery must be an object")
        recovery_keys = {
            "kind", "recoveryId", "acknowledgedProgressReceiptChainHeads",
            "recoveryRequestedAt",
        }
        base = {key: value for key, value in delivery.items() if key not in recovery_keys}
        self._validate_shortcut_proof_delivery(base)
        self._validate_exact_keys(
            delivery, set(base) | recovery_keys, "Shortcut terminal reconciliation delivery"
        )
        if delivery["kind"] != "native_terminal_reconcile":
            raise ValueError("Shortcut terminal reconciliation kind is unsupported")
        self._validated_required_uuid(delivery["recoveryId"], "Shortcut terminal recovery id")
        heads = delivery["acknowledgedProgressReceiptChainHeads"]
        maximum_heads = (
            len(EDIT_SUBDIVIDE_SHORTCUT_OPERATION_IDS)
            if delivery.get("executorId") == EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID
            else len(self._shortcut_operation_ids())
        )
        if (
            not isinstance(heads, list)
            or len(heads) > maximum_heads
            or len(set(heads)) != len(heads)
            or any(
                not isinstance(value, str)
                or CONTENT_SHA256_PATTERN.fullmatch(value) is None
                for value in heads
            )
        ):
            raise ValueError("Shortcut terminal reconciliation progress heads are invalid")
        self._validate_expiry(
            delivery["recoveryRequestedAt"],
            "Shortcut terminal reconciliation request time",
        )
        if datetime.fromisoformat(
            delivery["recoveryRequestedAt"].replace("Z", "+00:00")
        ) < datetime.fromisoformat(delivery["dispatchedAt"].replace("Z", "+00:00")):
            raise ValueError("Shortcut terminal reconciliation predates the original delivery")
        return delivery

    def _validate_shortcut_proof_recovery_ack(self, ack: Any) -> dict[str, Any]:
        if not isinstance(ack, dict):
            raise ValueError("Shortcut proof recovery acknowledgement must be an object")
        if ack.get("kind") == "native_history_transition_reconcile":
            self._validate_exact_keys(
                ack,
                {
                    "kind", "recoveryId", "expectedResultContentSha256", "results",
                    "expectedMarkerContentSha256",
                    "currentSceneFingerprintSha256", "occurredAt",
                },
                "Shortcut transition reconciliation acknowledgement",
            )
            self._validated_required_uuid(
                ack["recoveryId"], "Shortcut transition recovery id"
            )
            if (
                not isinstance(ack["expectedResultContentSha256"], str)
                or CONTENT_SHA256_PATTERN.fullmatch(
                    ack["expectedResultContentSha256"]
                )
                is None
            ):
                raise ValueError(
                    "Shortcut transition reconciliation expected result hash is invalid"
                )
            results = ack["results"]
            if not isinstance(results, list) or not 1 <= len(results) <= 32:
                raise ValueError("Shortcut transition reconciliation results are invalid")
            validated_results = [
                self._validate_shortcut_proof_result(result) for result in results
            ]
            if any(
                result["status"] not in {"restored", "reapplied_locked"}
                for result in validated_results
            ):
                raise ValueError("Shortcut transition reconciliation status is invalid")
            for previous, current in zip(
                validated_results, validated_results[1:]
            ):
                if previous["status"] == current["status"]:
                    raise ValueError(
                        "Shortcut transition reconciliation results must strictly alternate"
                    )
                if datetime.fromisoformat(
                    current["occurredAt"].replace("Z", "+00:00")
                ) <= datetime.fromisoformat(
                    previous["occurredAt"].replace("Z", "+00:00")
                ):
                    raise ValueError(
                        "Shortcut transition reconciliation results must be strictly chronological"
                    )
            for field in (
                "expectedMarkerContentSha256", "currentSceneFingerprintSha256"
            ):
                if (
                    not isinstance(ack[field], str)
                    or CONTENT_SHA256_PATTERN.fullmatch(ack[field]) is None
                ):
                    raise ValueError(
                        f"Shortcut transition reconciliation {field} is invalid"
                    )
            last = validated_results[-1]
            terminal = last["terminalEvidence"]
            if ack["currentSceneFingerprintSha256"] != terminal[
                "currentSceneFingerprintSha256"
            ]:
                raise ValueError(
                    "Shortcut transition reconciliation fingerprint is invalid"
                )
            self._validate_expiry(
                ack["occurredAt"], "Shortcut transition reconciliation time"
            )
            if datetime.fromisoformat(
                ack["occurredAt"].replace("Z", "+00:00")
            ) < datetime.fromisoformat(last["occurredAt"].replace("Z", "+00:00")):
                raise ValueError(
                    "Shortcut transition reconciliation acknowledgement predates its final result"
                )
            return ack
        if ack.get("kind") == "native_terminal_reconcile":
            self._validate_exact_keys(
                ack,
                {
                    "kind", "recoveryId", "result", "expectedMarkerContentSha256",
                    "currentSceneFingerprintSha256", "occurredAt",
                },
                "Shortcut terminal reconciliation acknowledgement",
            )
            self._validated_required_uuid(
                ack["recoveryId"], "Shortcut terminal recovery id"
            )
            result = self._validate_shortcut_proof_result(ack["result"])
            if result["status"] not in {"succeeded", "failed_checkpointed"}:
                raise ValueError("Shortcut terminal reconciliation result is not locked")
            for field in (
                "expectedMarkerContentSha256", "currentSceneFingerprintSha256"
            ):
                if (
                    not isinstance(ack[field], str)
                    or CONTENT_SHA256_PATTERN.fullmatch(ack[field]) is None
                ):
                    raise ValueError(f"Shortcut terminal reconciliation {field} is invalid")
            terminal = result["terminalEvidence"]
            checkpoint = (
                terminal["attestation"]["nativeUndoCheckpoint"]
                if result["status"] == "succeeded"
                else terminal["checkpoint"]
            )
            locked_sha256 = (
                checkpoint["finalSceneFingerprintSha256"]
                if result["status"] == "succeeded"
                else checkpoint["currentState"]["sceneFingerprintSha256"]
            )
            if ack["currentSceneFingerprintSha256"] != locked_sha256:
                raise ValueError("Shortcut terminal reconciliation does not prove locked state")
            self._validate_expiry(ack["occurredAt"], "Shortcut terminal reconciliation time")
            expected_marker = {
                "formatVersion": "1.0.0",
                "executorId": result["executorId"],
                "checkpointId": checkpoint["checkpointId"],
                "undoLockId": checkpoint["undoLockId"],
                "proofId": result["proofId"],
                "replayId": result["replayId"],
                "targetId": result["binding"]["acceptedAction"]["arguments"]["targetId"],
                "targetObjectName": "Cube",
                "checkpointKind": "success" if result["status"] == "succeeded" else "failure",
                "baselineSceneFingerprintSha256": (
                    checkpoint["baselineSceneFingerprintSha256"]
                    if result["status"] == "succeeded"
                    else checkpoint["baselineState"]["sceneFingerprintSha256"]
                ),
                "finalSceneFingerprintSha256": locked_sha256,
                "terminalResultContentSha256": self._canonical_sha256(result),
            }
            if ack["expectedMarkerContentSha256"] != self._canonical_sha256(expected_marker):
                raise ValueError("Shortcut terminal reconciliation marker hash is invalid")
            if datetime.fromisoformat(
                ack["occurredAt"].replace("Z", "+00:00")
            ) < datetime.fromisoformat(result["occurredAt"].replace("Z", "+00:00")):
                raise ValueError("Shortcut terminal reconciliation predates its result")
            return ack
        self._validate_exact_keys(
            ack,
            {
                "kind", "formatVersion", "requestId", "replayId", "proofId", "deliveryId",
                "target", "bindingContentSha256", "recoveryId", "history",
                "expectedMarkerContentSha256", "currentSceneFingerprintSha256",
                "mutationLocked", "status", "occurredAt",
            },
            "Shortcut proof recovery acknowledgement",
        )
        if ack["formatVersion"] != "1.0.0":
            raise ValueError("Shortcut proof recovery acknowledgement version is unsupported")
        for field in ("requestId", "replayId", "proofId", "deliveryId", "recoveryId"):
            self._validated_required_uuid(ack[field], f"Shortcut proof recovery {field}")
        if ack["target"] != {"adapterId": "blender", "instanceId": self._instance_id}:
            raise ValueError("Shortcut proof recovery acknowledgement targets another Companion")
        self._validate_shortcut_proof_history_identity(ack["history"])
        if ack["kind"] != "native_history_rebind" or ack["status"] not in {
            "succeeded", "failed_checkpointed", "restored", "reapplied_locked"
        }:
            raise ValueError("Shortcut proof recovery acknowledgement status is invalid")
        for field in (
            "bindingContentSha256", "expectedMarkerContentSha256",
            "currentSceneFingerprintSha256",
        ):
            if not isinstance(ack[field], str) or CONTENT_SHA256_PATTERN.fullmatch(ack[field]) is None:
                raise ValueError(f"Shortcut proof recovery {field} is invalid")
        expected_locked = ack["status"] != "restored"
        expected_fingerprint = (
            ack["history"]["baselineSceneFingerprintSha256"]
            if ack["status"] == "restored"
            else ack["history"]["lockedSceneFingerprintSha256"]
        )
        if ack["currentSceneFingerprintSha256"] != expected_fingerprint:
            raise ValueError("Shortcut proof recovery fingerprint is invalid")
        if ack["mutationLocked"] is not expected_locked:
            raise ValueError("Shortcut proof recovery lock state is invalid")
        self._validate_expiry(ack["occurredAt"], "Shortcut proof recovery acknowledgement time")
        return ack

    def _validate_shortcut_proof_progress(self, progress: Any) -> dict[str, Any]:
        validated = self._validate_shortcut_proof_identity(progress, "Shortcut proof progress")
        completed = validated["completedOperationIds"]
        maximum = 9 if validated["executorId"] == EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID else 4
        if validated["status"] != "in_progress" or not isinstance(completed, list) or not 1 <= len(completed) <= maximum or completed != validated["operationIds"][:len(completed)]:
            raise ValueError("Shortcut proof progress must be an exact operation prefix")
        if not isinstance(validated["receiptChainHeadSha256"], str) or CONTENT_SHA256_PATTERN.fullmatch(validated["receiptChainHeadSha256"]) is None:
            raise ValueError("Shortcut proof progress receipt head is invalid")
        return validated

    def _validate_shortcut_receipt_chain(
        self,
        receipts: Any,
        *,
        complete: bool,
        identity: dict[str, Any],
    ) -> list[dict[str, Any]]:
        if identity.get("executorId") == EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID:
            return self._validate_edit_subdivide_receipt_chain(receipts, complete=complete, identity=identity)
        if not isinstance(receipts, list) or len(receipts) > 4 or (complete and len(receipts) != 4):
            raise ValueError("Shortcut proof receipt chain has invalid length")
        previous = None
        for index, receipt in enumerate(receipts):
            if not isinstance(receipt, dict):
                raise ValueError("Shortcut proof receipt must be an object")
            common = {
                "receiptId", "proofId", "requestId", "deliveryId",
                "bindingContentSha256", "order", "previousReceiptContentSha256",
                "outcome", "occurredAt", "contentSha256", "operationId", "kind",
            }
            operation_id = self._shortcut_operation_ids()[index]
            extras = (
                {"context", "eventEvidence", "operatorStackBeforeSha256", "operatorStackAfterSha256"}
                if index in {0, 1, 3}
                else {"surfaceOperationId", "surfaceOperatorId", "controlId", "oldValue", "newValue", "eventEvidence"}
            )
            if index == 1:
                extras |= {"sourceOperationId", "sourceOperatorId"}
            if index == 3:
                extras |= {"surfaceOperationId"}
            self._validate_exact_keys(receipt, common | extras, "Shortcut proof operation receipt")
            if receipt["operationId"] != operation_id or receipt["order"] != index + 1 or receipt["outcome"] != "succeeded":
                raise ValueError("Shortcut proof receipt order or operation is invalid")
            if index == 2:
                if (
                    receipt["kind"] != "operator_property_update"
                    or receipt["surfaceOperationId"] != self._shortcut_operation_ids()[1]
                    or receipt["surfaceOperatorId"] != "object.subdivision_set"
                    or receipt["controlId"] != "object.subdivision_set.level"
                    or receipt["oldValue"] != 1
                    or receipt["newValue"] not in {1, 2, 3}
                ):
                    raise ValueError("Shortcut proof property receipt identity is invalid")
            elif (
                receipt["kind"] != "key_input"
                or not isinstance(receipt["context"], dict)
                or receipt["context"]
                != {
                    "windowId": receipt["context"].get("windowId"),
                    "areaType": "VIEW_3D",
                    "regionType": "WINDOW",
                    "mode": "OBJECT",
                }
                or not isinstance(receipt["context"].get("windowId"), str)
                or not receipt["context"]["windowId"]
                or (index == 1 and (
                    receipt["sourceOperationId"] != self._shortcut_operation_ids()[0]
                    or receipt["sourceOperatorId"] != "object.subdivision_set"
                ))
                or (index == 3 and receipt["surfaceOperationId"] != self._shortcut_operation_ids()[1])
            ):
                raise ValueError("Shortcut proof key receipt identity is invalid")
            if any(
                receipt[field] != identity[field]
                for field in (
                    "proofId", "requestId", "deliveryId", "bindingContentSha256"
                )
            ):
                raise ValueError("Shortcut proof receipt delivery identity is invalid")
            self._validated_required_uuid(receipt["receiptId"], "Shortcut proof receipt id")
            self._validate_expiry(receipt["occurredAt"], "Shortcut proof receipt time")
            if receipt["previousReceiptContentSha256"] != previous:
                raise ValueError("Shortcut proof receipt chain link is invalid")
            content = {key: value for key, value in receipt.items() if key != "contentSha256"}
            if receipt["contentSha256"] != self._canonical_sha256(content):
                raise ValueError("Shortcut proof receipt content hash is invalid")
            events = receipt.get("eventEvidence")
            if not isinstance(events, list) or len(events) != (2, 2, 9, 2)[index]:
                raise ValueError("Shortcut proof receipt event evidence must be an array")
            level_event = (
                ({1: "ONE", 2: "TWO", 3: "THREE"}[receipt["newValue"]], "PRESS", False, "viewport_center", str(receipt["newValue"]))
                if index == 2
                else ("ONE", "PRESS", False, "viewport_center", "1")
            )
            expected_events = (
                (("ONE", "PRESS", True, "viewport_center", None), ("ONE", "RELEASE", True, "viewport_center", None)),
                (("F9", "PRESS", False, "viewport_center", None), ("F9", "RELEASE", False, "viewport_center", None)),
                (
                    ("MOUSEMOVE", "NOTHING", False, "level_control", None),
                    ("LEFTMOUSE", "PRESS", False, "level_control", None),
                    ("LEFTMOUSE", "RELEASE", False, "level_control", None),
                    ("LEFTMOUSE", "PRESS", False, "level_control", None),
                    ("LEFTMOUSE", "RELEASE", False, "level_control", None),
                    ("A", "PRESS", True, "viewport_center", None),
                    level_event,
                    ("RET", "PRESS", False, "viewport_center", None),
                    ("RET", "RELEASE", False, "viewport_center", None),
                ),
                (("RET", "PRESS", False, "viewport_center", None), ("RET", "RELEASE", False, "viewport_center", None)),
            )[index]
            for event, expected_event in zip(events, expected_events):
                if not isinstance(event, dict):
                    raise ValueError("Shortcut proof event evidence must be an object")
                expected_type, expected_value, expected_ctrl, expected_role, expected_unicode = expected_event
                allowed = {"type", "value", "ctrl", "shift", "point"} | ({"unicode"} if expected_unicode is not None else set())
                self._validate_exact_keys(event, allowed, "Shortcut proof event evidence")
                point = event.get("point")
                if not isinstance(point, dict):
                    raise ValueError("Shortcut proof event point must be an object")
                self._validate_exact_keys(point, {"x", "y", "role"}, "Shortcut proof event point")
                if (
                    event["type"] != expected_type
                    or event["value"] != expected_value
                    or event["ctrl"] is not expected_ctrl
                    or event["shift"] is not False
                    or event.get("unicode") != expected_unicode
                    or point["role"] != expected_role
                    or isinstance(point["x"], bool)
                    or not isinstance(point["x"], int)
                    or isinstance(point["y"], bool)
                    or not isinstance(point["y"], int)
                ):
                    raise ValueError("Shortcut proof event evidence tuple is invalid")
            previous = receipt["contentSha256"]
        return receipts

    def _validate_edit_subdivide_receipt_chain(self, receipts: Any, *, complete: bool, identity: dict[str, Any]) -> list[dict[str, Any]]:
        if not isinstance(receipts, list) or len(receipts) > 9 or (complete and len(receipts) != 9):
            raise ValueError("Edit Subdivide receipt chain has invalid length")
        previous = None
        modes = ("OBJECT", "EDIT_MESH", "EDIT_MESH", "EDIT_MESH", "EDIT_MESH", "EDIT_MESH", "EDIT_MESH", "EDIT_MESH", "EDIT_MESH")
        key_types = ("TAB", "A", "F3", "RET", "F9", None, None, "RET", "TAB")
        for index, receipt in enumerate(receipts):
            if not isinstance(receipt, dict):
                raise ValueError("Edit Subdivide receipt must be an object")
            common = {"receiptId", "proofId", "requestId", "deliveryId", "bindingContentSha256", "operationId", "order", "previousReceiptContentSha256", "outcome", "occurredAt", "contentSha256", "kind", "context"}
            if index in {5, 6}:
                expected_keys = common | {"surfaceOperationId", "surfaceOperatorId", "controlId", "newValue", "enteredText", "activationEventEvidence", "selectAllEventEvidence", "textEventEvidence", "confirmEventEvidence"}
            else:
                extras = ({"modeBefore", "modeAfter"} if index in {0, 8} else {"allVisibleMeshElementsSelected"} if index == 1 else {"query", "selectedOperatorId", "queryEventEvidence"} if index == 2 else {"executedOperatorId"} if index == 3 else {"sourceOperationId", "sourceOperatorId"} if index == 4 else {"surfaceOperationId"})
                expected_keys = common | {"eventEvidence", "operatorStackBeforeSha256", "operatorStackAfterSha256"} | extras
            self._validate_exact_keys(receipt, expected_keys, "Edit Subdivide operation receipt")
            if any(receipt.get(field) != identity[field] for field in ("proofId", "requestId", "deliveryId", "bindingContentSha256")):
                raise ValueError("Edit Subdivide receipt delivery identity is invalid")
            if receipt.get("operationId") != EDIT_SUBDIVIDE_SHORTCUT_OPERATION_IDS[index] or receipt.get("order") != index + 1 or receipt.get("outcome") != "succeeded" or receipt.get("previousReceiptContentSha256") != previous:
                raise ValueError("Edit Subdivide receipt order is invalid")
            context = receipt.get("context")
            if isinstance(context, dict):
                self._validate_exact_keys(
                    context,
                    {"windowId", "areaType", "regionType", "mode"},
                    "Edit Subdivide receipt context",
                )
            if not isinstance(context, dict) or context.get("areaType") != "VIEW_3D" or context.get("regionType") != "WINDOW" or context.get("mode") != modes[index] or not isinstance(context.get("windowId"), str) or not context["windowId"]:
                raise ValueError("Edit Subdivide receipt context is invalid")
            content = {key: value for key, value in receipt.items() if key != "contentSha256"}
            if receipt.get("contentSha256") != self._canonical_sha256(content):
                raise ValueError("Edit Subdivide receipt hash is invalid")
            self._validated_required_uuid(receipt.get("receiptId"), "Edit Subdivide receipt id")
            self._validate_expiry(receipt.get("occurredAt"), "Edit Subdivide receipt time")
            if index in {5, 6}:
                expected_control = ("mesh.subdivide.number_cuts", "mesh.subdivide.smoothness")[index - 5]
                expected_role = ("number_cuts_control", "smoothness_control")[index - 5]
                expected_text = str(receipt.get("newValue"))
                if isinstance(receipt.get("newValue"), float) and receipt["newValue"].is_integer():
                    expected_text = str(int(receipt["newValue"]))
                if receipt.get("kind") != "operator_property_update" or receipt.get("surfaceOperationId") != EDIT_SUBDIVIDE_SHORTCUT_OPERATION_IDS[4] or receipt.get("surfaceOperatorId") != "mesh.subdivide" or receipt.get("controlId") != expected_control or receipt.get("enteredText") != expected_text:
                    raise ValueError("Edit Subdivide property receipt is invalid")
                activation = receipt.get("activationEventEvidence")
                select_all = receipt.get("selectAllEventEvidence")
                text_events = receipt.get("textEventEvidence")
                confirm = receipt.get("confirmEventEvidence")
                if not isinstance(activation, list) or len(activation) != 5 or not isinstance(select_all, list) or len(select_all) != 1 or not isinstance(text_events, list) or not text_events or not isinstance(confirm, list) or len(confirm) != 2:
                    raise ValueError("Edit Subdivide property event evidence is incomplete")
                expected_activation = (("MOUSEMOVE", "NOTHING"), ("LEFTMOUSE", "PRESS"), ("LEFTMOUSE", "RELEASE"), ("LEFTMOUSE", "PRESS"), ("LEFTMOUSE", "RELEASE"))
                for event, (event_type, value) in zip(activation, expected_activation):
                    self._validate_edit_subdivide_event(event, event_type, value, expected_role)
                self._validate_edit_subdivide_event(select_all[0], "A", "PRESS", "viewport_center", ctrl=True)
                if "".join(str(event.get("unicode", "")) for event in text_events) != receipt["enteredText"]:
                    raise ValueError("Edit Subdivide typed property text is invalid")
                for event in text_events:
                    expected_type = "PERIOD" if event.get("unicode") == "." else ("ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE")[int(event["unicode"])]
                    self._validate_edit_subdivide_event(event, expected_type, "PRESS", "viewport_center", unicode=str(event["unicode"]))
                self._validate_edit_subdivide_event(confirm[0], "RET", "PRESS", "viewport_center")
                self._validate_edit_subdivide_event(confirm[1], "RET", "RELEASE", "viewport_center")
            else:
                if receipt.get("kind") != "key_input" or CONTENT_SHA256_PATTERN.fullmatch(str(receipt.get("operatorStackBeforeSha256"))) is None or CONTENT_SHA256_PATTERN.fullmatch(str(receipt.get("operatorStackAfterSha256"))) is None:
                    raise ValueError("Edit Subdivide key receipt is invalid")
                events = receipt.get("eventEvidence")
                if not isinstance(events, list) or len(events) != 2:
                    raise ValueError("Edit Subdivide key event evidence is invalid")
                event_type = key_types[index]
                assert event_type is not None
                self._validate_edit_subdivide_event(events[0], event_type, "PRESS", "viewport_center")
                self._validate_edit_subdivide_event(events[1], event_type, "RELEASE", "viewport_center")
                if index == 2:
                    query = receipt.get("queryEventEvidence")
                    if receipt.get("query") != "subdivide" or receipt.get("selectedOperatorId") != "mesh.subdivide" or not isinstance(query, list) or len(query) != 9:
                        raise ValueError("Edit Subdivide search receipt is invalid")
                    for event, character in zip(query, "subdivide"):
                        self._validate_edit_subdivide_event(event, character.upper(), "PRESS", "viewport_center", unicode=character)
                expected_extra = (
                    receipt.get("modeBefore") == "OBJECT" and receipt.get("modeAfter") == "EDIT_MESH"
                    if index == 0 else receipt.get("allVisibleMeshElementsSelected") is True
                    if index == 1 else receipt.get("executedOperatorId") == "mesh.subdivide"
                    if index == 3 else receipt.get("sourceOperationId") == EDIT_SUBDIVIDE_SHORTCUT_OPERATION_IDS[3] and receipt.get("sourceOperatorId") == "mesh.subdivide"
                    if index == 4 else receipt.get("surfaceOperationId") == EDIT_SUBDIVIDE_SHORTCUT_OPERATION_IDS[4]
                    if index == 7 else receipt.get("modeBefore") == "EDIT_MESH" and receipt.get("modeAfter") == "OBJECT"
                    if index == 8 else True
                )
                if not expected_extra:
                    raise ValueError("Edit Subdivide key receipt semantic evidence is invalid")
            previous = receipt["contentSha256"]
        return receipts

    def _validate_edit_subdivide_event(self, event: Any, event_type: str, value: str, role: str, *, ctrl: bool = False, unicode: str | None = None) -> None:
        if isinstance(event, dict):
            expected_keys = {"type", "value", "ctrl", "shift", "point"}
            if unicode is not None:
                expected_keys.add("unicode")
            self._validate_exact_keys(event, expected_keys, "Edit Subdivide event evidence")
        if not isinstance(event, dict) or event.get("type") != event_type or event.get("value") != value or event.get("ctrl") is not ctrl or event.get("shift") is not False or event.get("unicode") != unicode:
            raise ValueError("Edit Subdivide event tuple is invalid")
        point = event.get("point")
        if isinstance(point, dict):
            self._validate_exact_keys(
                point, {"x", "y", "role"}, "Edit Subdivide event point"
            )
        if not isinstance(point, dict) or point.get("role") != role or isinstance(point.get("x"), bool) or not isinstance(point.get("x"), int) or isinstance(point.get("y"), bool) or not isinstance(point.get("y"), int):
            raise ValueError("Edit Subdivide event point is invalid")

    @staticmethod
    def _shortcut_operation_ids() -> list[str]:
        return [
            "shortcut.add_subdivision_surface_level_one",
            "shortcut.open_adjust_last_operation",
            "shortcut.set_viewport_level",
            "shortcut.close_adjust_last_operation",
        ]

    def _validate_shortcut_checkpoint(self, checkpoint: Any, *, failure: bool) -> dict[str, Any]:
        if isinstance(checkpoint, dict) and checkpoint.get("executorId") == EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID:
            return self._validate_edit_subdivide_checkpoint(checkpoint, failure=failure)
        if not isinstance(checkpoint, dict):
            raise ValueError("Shortcut proof checkpoint must be an object")
        success_keys = {
            "formatVersion", "evidenceClass", "checkpointId", "proofId", "replayId",
            "previousCheckpointId", "operation", "undoLockId", "targetId", "marker",
            "journal", "baselineState", "finalState", "baselineSceneFingerprintSha256",
            "finalSceneFingerprintSha256", "receiptChainRootSha256", "receiptChainHeadSha256",
            "strongObservationContentSha256", "committedAt",
        }
        failure_keys = {
            "formatVersion", "evidenceClass", "checkpointId", "previousCheckpointId",
            "operation", "undoLockId", "proofId", "replayId", "targetId", "marker",
            "journal", "baselineState", "currentState", "receiptPrefixRootSha256",
            "receiptPrefixHeadSha256", "lastCompletedOperationId", "committedAt",
        }
        self._validate_exact_keys(checkpoint, failure_keys if failure else success_keys, "Shortcut proof checkpoint")
        for field in ("checkpointId", "proofId", "replayId", "undoLockId"):
            self._validated_required_uuid(checkpoint[field], f"Shortcut proof checkpoint {field}")
        if checkpoint["previousCheckpointId"] is not None:
            self._validated_required_uuid(checkpoint["previousCheckpointId"], "Shortcut proof previous checkpoint id")
        self._validate_expiry(checkpoint["committedAt"], "Shortcut proof checkpoint time")
        marker = checkpoint["marker"]
        journal = checkpoint["journal"]
        baseline = checkpoint["baselineState"]
        if not isinstance(marker, dict) or not isinstance(journal, dict) or not isinstance(baseline, dict):
            raise ValueError("Shortcut proof checkpoint nested evidence is invalid")
        self._validate_exact_keys(marker, {"key", "matched"}, "Shortcut proof checkpoint marker")
        if marker != {"key": "_operating_line_shortcut_proof_history_v1", "matched": True}:
            raise ValueError("Shortcut proof checkpoint marker is invalid")
        if failure:
            current = checkpoint["currentState"]
            self._validate_exact_keys(journal, {"entryPresent", "baselineSnapshotPresent", "currentSnapshotPresent", "mutationLeaseHeld"}, "Shortcut failure checkpoint journal")
            self._validate_exact_keys(baseline, {"targetId", "sceneFingerprintSha256", "modifierCount"}, "Shortcut failure baseline state")
            if not isinstance(current, dict):
                raise ValueError("Shortcut failure current state is invalid")
            self._validate_exact_keys(current, {"targetId", "sceneFingerprintSha256", "modifierCount"}, "Shortcut failure current state")
            if (
                checkpoint["formatVersion"] != "1.0.0"
                or checkpoint["evidenceClass"] != "companion_reported_shortcut_proof_failure_checkpoint"
                or checkpoint["operation"] != "shortcut_proof_failure"
                or journal != {"entryPresent": True, "baselineSnapshotPresent": True, "currentSnapshotPresent": True, "mutationLeaseHeld": True}
                or baseline["targetId"] != checkpoint["targetId"]
                or baseline["modifierCount"] != 0
                or current["targetId"] != checkpoint["targetId"]
            ):
                raise ValueError("Shortcut failure checkpoint nested evidence is inconsistent")
        else:
            final = checkpoint["finalState"]
            self._validate_exact_keys(journal, {"entryPresent", "baselineSnapshotPresent", "finalSnapshotPresent", "undoRedoRoundTripVerified", "mutationLeaseHeld"}, "Shortcut success checkpoint journal")
            self._validate_exact_keys(baseline, {"targetId", "modifierCount", "activeObjectMode", "selectedObjectCount"}, "Shortcut success baseline state")
            if not isinstance(final, dict):
                raise ValueError("Shortcut success final state is invalid")
            self._validate_exact_keys(final, {"targetId", "modifierType", "modifierCount", "viewportLevel"}, "Shortcut success final state")
            if (
                checkpoint["formatVersion"] != "1.0.0"
                or checkpoint["evidenceClass"] != "companion_reported_shortcut_proof_native_undo_checkpoint"
                or checkpoint["operation"] != "shortcut_proof"
                or journal != {"entryPresent": True, "baselineSnapshotPresent": True, "finalSnapshotPresent": True, "undoRedoRoundTripVerified": True, "mutationLeaseHeld": True}
                or baseline != {"targetId": checkpoint["targetId"], "modifierCount": 0, "activeObjectMode": "OBJECT", "selectedObjectCount": 1}
                or final.get("targetId") != checkpoint["targetId"]
                or final.get("modifierType") != "SUBSURF"
                or final.get("modifierCount") != 1
                or final.get("viewportLevel") not in {1, 2, 3}
            ):
                raise ValueError("Shortcut success checkpoint nested evidence is inconsistent")
        return checkpoint

    def _validate_edit_subdivide_checkpoint(self, checkpoint: dict[str, Any], *, failure: bool) -> dict[str, Any]:
        common = {"formatVersion", "evidenceClass", "checkpointId", "proofId", "replayId", "previousCheckpointId", "operation", "undoLockId", "targetId", "executorId", "nativeMutationKind", "nativeUndoDepth", "nativeRedoDepth", "marker", "journal", "baselineState", "committedAt"}
        extra = {"currentState", "receiptPrefixRootSha256", "receiptPrefixHeadSha256", "lastCompletedOperationId"} if failure else {"finalState", "baselineSceneFingerprintSha256", "finalSceneFingerprintSha256", "receiptChainRootSha256", "receiptChainHeadSha256", "strongObservationContentSha256"}
        self._validate_exact_keys(checkpoint, common | extra, "Edit Subdivide checkpoint")
        if checkpoint["executorId"] != EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID or checkpoint["nativeMutationKind"] != "in_place_edit_mesh_subdivide" or checkpoint["nativeUndoDepth"] != 4 or checkpoint["nativeRedoDepth"] != 4 or checkpoint["marker"] != {"key": "_operating_line_shortcut_proof_history_v2", "matched": True}:
            raise ValueError("Edit Subdivide checkpoint authority is invalid")
        for field in ("checkpointId", "proofId", "replayId", "undoLockId"):
            self._validated_required_uuid(checkpoint[field], f"Edit Subdivide checkpoint {field}")
        self._validate_expiry(checkpoint["committedAt"], "Edit Subdivide checkpoint time")
        baseline = checkpoint["baselineState"]
        current = checkpoint["currentState"] if failure else checkpoint["finalState"]
        success_state_keys = {"targetId", "objectName", "objectPointer", "meshPointer", "meshUsers", "meshDatablockCount", "modifierCount", "shapeKeyCount", "activeObjectMode", "selectedObjectCount", "topologySha256", "geometrySha256"}
        failure_state_keys = {"targetId", "sceneFingerprintSha256", "objectName", "objectPointer", "meshPointer", "meshUsers", "meshDatablockCount", "modifierCount", "shapeKeyCount", "topologySha256", "geometrySha256"}
        if isinstance(baseline, dict):
            self._validate_exact_keys(baseline, failure_state_keys if failure else success_state_keys, "Edit Subdivide checkpoint baseline state")
        if isinstance(current, dict):
            self._validate_exact_keys(current, failure_state_keys if failure else success_state_keys | {"cuts", "smooth"}, "Edit Subdivide checkpoint final state")
        if not isinstance(baseline, dict) or not isinstance(current, dict) or baseline.get("targetId") != checkpoint["targetId"] or current.get("targetId") != checkpoint["targetId"] or baseline.get("objectName") != "Cube" or current.get("objectName") != "Cube" or baseline.get("meshUsers") != 1 or current.get("meshUsers") != 1 or baseline.get("meshDatablockCount") != 1 or current.get("meshDatablockCount") != 1 or baseline.get("modifierCount") != 0 or current.get("modifierCount") != 0 or baseline.get("shapeKeyCount") != 0 or current.get("shapeKeyCount") != 0:
            raise ValueError("Edit Subdivide checkpoint state identity is invalid")
        continuity_fields = ("objectPointer", "meshPointer", "meshDatablockCount")
        if any(baseline.get(field) != current.get(field) for field in continuity_fields):
            raise ValueError("Edit Subdivide checkpoint identity continuity is invalid")
        if failure:
            if checkpoint["evidenceClass"] != "companion_reported_shortcut_proof_failure_checkpoint" or checkpoint["operation"] != "shortcut_proof_failure" or checkpoint["journal"] != {"entryPresent": True, "baselineSnapshotPresent": True, "currentSnapshotPresent": True, "mutationLeaseHeld": True} or checkpoint["lastCompletedOperationId"] not in EDIT_SUBDIVIDE_SHORTCUT_OPERATION_IDS + [None]:
                raise ValueError("Edit Subdivide failure checkpoint is invalid")
        else:
            if checkpoint["evidenceClass"] != "companion_reported_shortcut_proof_native_undo_checkpoint" or checkpoint["operation"] != "shortcut_proof" or checkpoint["journal"] != {"entryPresent": True, "baselineSnapshotPresent": True, "finalSnapshotPresent": True, "undoRedoRoundTripVerified": True, "mutationLeaseHeld": True} or current.get("activeObjectMode") != "OBJECT" or current.get("selectedObjectCount") != 1:
                raise ValueError("Edit Subdivide success checkpoint is invalid")
        return checkpoint

    def _validate_shortcut_native_observation(
        self,
        observation: Any,
        *,
        id_field: str,
        expected_fingerprint: str,
        label: str,
    ) -> dict[str, Any]:
        if not isinstance(observation, dict):
            raise ValueError(f"{label} must be an object")
        self._validate_exact_keys(
            observation,
            {"satisfied", id_field, "sceneFingerprintSha256", "contentSha256"},
            label,
        )
        self._validated_required_uuid(observation[id_field], f"{label} id")
        if (
            observation["satisfied"] is not True
            or observation["sceneFingerprintSha256"] != expected_fingerprint
            or not isinstance(observation["contentSha256"], str)
            or CONTENT_SHA256_PATTERN.fullmatch(observation["contentSha256"]) is None
        ):
            raise ValueError(f"{label} does not prove its expected scene fingerprint")
        content = {
            key: value for key, value in observation.items() if key != "contentSha256"
        }
        if observation["contentSha256"] != self._canonical_sha256(content):
            raise ValueError(f"{label} content hash is invalid")
        return observation

    def _validate_shortcut_strong_observation(
        self,
        observation: Any,
        *,
        binding: dict[str, Any],
    ) -> dict[str, Any]:
        if binding.get("executorId") == EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID:
            return self._validate_edit_subdivide_strong_observation(observation, binding=binding)
        if not isinstance(observation, dict):
            raise ValueError("Shortcut proof strong observation must be an object")
        self._validate_exact_keys(
            observation,
            {
                "kind", "satisfied", "observationId", "observedAt", "contentSha256",
                "targetId", "modifierType", "modifierCount", "viewportLevel",
                "subdivisionType", "renderLevels", "quality", "modifierStackMatches",
                "evaluatedTopologyWithinBounds", "sceneFingerprintSha256",
            },
            "Shortcut proof strong observation",
        )
        self._validated_required_uuid(
            observation["observationId"], "Shortcut proof observation id"
        )
        self._validate_expiry(
            observation["observedAt"], "Shortcut proof observation time"
        )
        accepted = binding["acceptedAction"]["arguments"]
        if (
            observation["kind"] != "subdivision_surface_shortcut_ready"
            or observation["satisfied"] is not True
            or observation["targetId"] != accepted["targetId"]
            or observation["modifierType"] != "SUBSURF"
            or observation["modifierCount"] != 1
            or observation["viewportLevel"] != accepted["viewportLevel"]
            or observation["subdivisionType"] != "CATMULL_CLARK"
            or observation["renderLevels"] != 2
            or observation["quality"] != 3
            or observation["modifierStackMatches"] is not True
            or observation["evaluatedTopologyWithinBounds"] is not True
            or not isinstance(observation["sceneFingerprintSha256"], str)
            or CONTENT_SHA256_PATTERN.fullmatch(
                observation["sceneFingerprintSha256"]
            )
            is None
        ):
            raise ValueError("Shortcut proof strong observation is invalid")
        content = {
            key: value for key, value in observation.items() if key != "contentSha256"
        }
        if observation["contentSha256"] != self._canonical_sha256(content):
            raise ValueError("Shortcut proof strong observation content hash is invalid")
        return observation

    def _validate_edit_subdivide_strong_observation(self, observation: Any, *, binding: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(observation, dict):
            raise ValueError("Edit Subdivide strong observation must be an object")
        keys = {"kind", "satisfied", "observationId", "observedAt", "contentSha256", "targetId", "objectName", "objectPointer", "meshName", "meshPointer", "meshUsers", "meshDatablockCount", "sameObjectIdentity", "sameMeshIdentity", "managedReplacementMeshCreated", "modifierCount", "shapeKeyCount", "activeObjectMode", "selectedObjectCount", "operatorId", "cuts", "smooth", "topology", "topologySha256", "geometrySha256", "sceneFingerprintSha256"}
        self._validate_exact_keys(observation, keys, "Edit Subdivide strong observation")
        accepted = binding["acceptedAction"]["arguments"]
        segments = accepted["cuts"] + 1
        expected_topology = {"vertices": 6 * segments * segments + 2, "edges": 12 * segments * segments, "polygons": 6 * segments * segments}
        topology = observation.get("topology")
        if isinstance(topology, dict):
            self._validate_exact_keys(
                topology,
                {"vertices", "edges", "polygons"},
                "Edit Subdivide observation topology",
            )
        if observation["kind"] != "mesh_edit_subdivide_shortcut_ready" or observation["satisfied"] is not True or observation["targetId"] != accepted["targetId"] or observation["objectName"] != "Cube" or observation["meshUsers"] != 1 or observation["sameObjectIdentity"] is not True or observation["sameMeshIdentity"] is not True or observation["managedReplacementMeshCreated"] is not False or observation["modifierCount"] != 0 or observation["shapeKeyCount"] != 0 or observation["activeObjectMode"] != "OBJECT" or observation["selectedObjectCount"] != 1 or observation["operatorId"] != "MESH_OT_subdivide" or observation["cuts"] != accepted["cuts"] or observation["smooth"] != accepted["smooth"] or observation["topology"] != expected_topology:
            raise ValueError("Edit Subdivide strong observation is invalid")
        self._validated_required_uuid(observation["observationId"], "Edit Subdivide observation id")
        self._validate_expiry(observation["observedAt"], "Edit Subdivide observation time")
        for field in ("topologySha256", "geometrySha256", "sceneFingerprintSha256"):
            if CONTENT_SHA256_PATTERN.fullmatch(str(observation[field])) is None:
                raise ValueError(f"Edit Subdivide observation {field} is invalid")
        for field in ("objectPointer", "meshPointer", "meshDatablockCount"):
            if isinstance(observation[field], bool) or not isinstance(observation[field], int) or observation[field] <= 0:
                raise ValueError(f"Edit Subdivide observation {field} must be positive")
        if observation["contentSha256"] != self._canonical_sha256({key: value for key, value in observation.items() if key != "contentSha256"}):
            raise ValueError("Edit Subdivide strong observation hash is invalid")
        return observation

    def _validate_shortcut_proof_result(self, result: Any) -> dict[str, Any]:
        validated = self._validate_shortcut_proof_identity(result, "Shortcut proof result", terminal=True)
        statuses = {"succeeded", "failed_checkpointed", "failed_restored", "rejected", "restored", "reapplied_locked"}
        if validated["status"] not in statuses or validated["managedActionResult"] != "not_executed" or validated["managedIdentityVerified"] is not False:
            raise ValueError("Shortcut proof result status or managed claims are invalid")
        if validated["executorId"] == EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID and (validated["managedReceiptCreated"] is not False or validated["managedReplacementMeshCreated"] is not False or validated["nativeMutationKind"] != "in_place_edit_mesh_subdivide"):
            raise ValueError("Edit Subdivide result managed claims are invalid")
        if not isinstance(validated["terminalEvidence"], dict):
            raise ValueError("Shortcut proof terminal evidence must be an object")
        expected_kind = {
            "succeeded": "succeeded_locked", "failed_checkpointed": "failed_checkpointed",
            "failed_restored": "failed_restored", "rejected": "rejected_before_mutation",
            "restored": "restored", "reapplied_locked": "reapplied_locked",
        }[validated["status"]]
        if validated["terminalEvidence"].get("kind") != expected_kind:
            raise ValueError("Shortcut proof result evidence does not match its status")
        should_lock = validated["status"] in {"succeeded", "failed_checkpointed", "reapplied_locked"}
        if validated["requiresUndoToUnlock"] is not should_lock:
            raise ValueError("Shortcut proof result lock state is invalid")
        if (validated["error"] is None) != (validated["status"] in {"succeeded", "restored", "reapplied_locked"}):
            raise ValueError("Shortcut proof result error state is invalid")
        evidence = validated["terminalEvidence"]
        if expected_kind == "rejected_before_mutation":
            self._validate_exact_keys(evidence, {"kind", "mutationStarted"}, "Shortcut proof rejection evidence")
            if evidence["mutationStarted"] is not False:
                raise ValueError("Shortcut proof rejection cannot claim mutation")
        elif expected_kind == "failed_restored":
            self._validate_exact_keys(evidence, {"kind", "receiptPrefix", "lastCompletedOperationId", "baselineSceneFingerprintSha256", "currentSceneFingerprintSha256", "nativeUndoObservation", "mutationStarted"}, "Shortcut proof restored failure evidence")
            self._validate_shortcut_receipt_chain(
                evidence["receiptPrefix"], complete=False, identity=validated
            )
            if evidence["baselineSceneFingerprintSha256"] != evidence["currentSceneFingerprintSha256"]:
                raise ValueError("Shortcut proof restored failure did not return to baseline")
            self._validate_shortcut_native_observation(
                evidence["nativeUndoObservation"],
                id_field="restorationObservationId",
                expected_fingerprint=evidence["currentSceneFingerprintSha256"],
                label="Shortcut proof failure Undo observation",
            )
        elif expected_kind == "failed_checkpointed":
            self._validate_exact_keys(evidence, {"kind", "checkpoint", "receiptPrefix", "lastCompletedOperationId", "baselineSceneFingerprintSha256", "currentSceneFingerprintSha256", "mutationStarted"}, "Shortcut proof checkpointed failure evidence")
            self._validate_shortcut_checkpoint(evidence["checkpoint"], failure=True)
            self._validate_shortcut_receipt_chain(
                evidence["receiptPrefix"], complete=False, identity=validated
            )
        elif expected_kind == "succeeded_locked":
            self._validate_exact_keys(evidence, {"kind", "attestation"}, "Shortcut proof success evidence")
            attestation = evidence["attestation"]
            if not isinstance(attestation, dict):
                raise ValueError("Shortcut proof attestation must be an object")
            attestation_keys = {"formatVersion", "attestationId", "deliveryId", "binding", "bindingContentSha256", "managedActionResult", "managedIdentityVerified", "executor", "operationReceipts", "strongObservation", "nativeUndoCheckpoint", "attestedAt", "integrity"}
            if validated["executorId"] == EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID:
                attestation_keys |= {"managedReceiptCreated", "managedReplacementMeshCreated", "nativeMutationKind"}
            self._validate_exact_keys(attestation, attestation_keys, "Shortcut proof attestation")
            self._validated_required_uuid(attestation["attestationId"], "Shortcut proof attestation id")
            self._validated_required_uuid(attestation["deliveryId"], "Shortcut proof attestation delivery id")
            if (
                attestation["deliveryId"] != validated["deliveryId"]
                or attestation["binding"] != validated["binding"]
                or attestation["bindingContentSha256"] != validated["bindingContentSha256"]
                or attestation["managedActionResult"] != "not_executed"
                or attestation["managedIdentityVerified"] is not False
                or attestation["executor"] != {
                    "executorId": validated["executorId"],
                    "executionBoundary": validated["executionBoundary"],
                    "transport": validated["transport"],
                    "osHidInput": False,
                }
            ):
                raise ValueError("Shortcut proof attestation binding is inconsistent")
            if validated["executorId"] == EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID and (attestation["managedReceiptCreated"] is not False or attestation["managedReplacementMeshCreated"] is not False or attestation["nativeMutationKind"] != "in_place_edit_mesh_subdivide"):
                raise ValueError("Edit Subdivide attestation managed claims are invalid")
            receipts = self._validate_shortcut_receipt_chain(
                attestation["operationReceipts"], complete=True, identity=validated
            )
            strong = self._validate_shortcut_strong_observation(
                attestation["strongObservation"], binding=validated["binding"]
            )
            checkpoint = self._validate_shortcut_checkpoint(
                attestation["nativeUndoCheckpoint"], failure=False
            )
            accepted = validated["binding"]["acceptedAction"]["arguments"]
            checkpoint_mismatch = (
                checkpoint["proofId"] != validated["proofId"]
                or checkpoint["replayId"] != validated["replayId"]
                or checkpoint["targetId"] != accepted["targetId"]
                or checkpoint["receiptChainRootSha256"] != receipts[0]["contentSha256"]
                or checkpoint["receiptChainHeadSha256"] != receipts[-1]["contentSha256"]
                or checkpoint["strongObservationContentSha256"] != strong["contentSha256"]
                or checkpoint["finalSceneFingerprintSha256"]
                != strong["sceneFingerprintSha256"]
            )
            if validated["executorId"] == EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID:
                checkpoint_mismatch = checkpoint_mismatch or checkpoint["finalState"]["cuts"] != accepted["cuts"] or checkpoint["finalState"]["smooth"] != accepted["smooth"] or checkpoint["finalState"]["objectPointer"] != strong["objectPointer"] or checkpoint["finalState"]["meshPointer"] != strong["meshPointer"] or checkpoint["finalState"]["meshDatablockCount"] != strong["meshDatablockCount"] or checkpoint["finalState"]["topologySha256"] != strong["topologySha256"] or checkpoint["finalState"]["geometrySha256"] != strong["geometrySha256"]
            else:
                checkpoint_mismatch = checkpoint_mismatch or checkpoint["finalState"]["viewportLevel"] != accepted["viewportLevel"]
            if checkpoint_mismatch:
                raise ValueError("Shortcut proof checkpoint evidence is inconsistent")
            integrity = attestation["integrity"]
            if not isinstance(integrity, dict):
                raise ValueError("Shortcut proof attestation integrity must be an object")
            self._validate_exact_keys(integrity, {"algorithm", "canonicalization", "contentSha256"}, "Shortcut proof attestation integrity")
            attestation_content = {key: value for key, value in attestation.items() if key != "integrity"}
            if integrity.get("contentSha256") != self._canonical_sha256(attestation_content):
                raise ValueError("Shortcut proof attestation content hash is invalid")
        else:
            transition_keys = {
                "kind", "sourceCheckpointId", "undoLockId",
                "baselineSceneFingerprintSha256", "lockedSceneFingerprintSha256",
                "currentSceneFingerprintSha256",
                "nativeUndoObservation" if expected_kind == "restored" else "nativeRedoObservation",
                "restoredAt" if expected_kind == "restored" else "reappliedAt",
            }
            self._validate_exact_keys(evidence, transition_keys, "Shortcut proof native history evidence")
            expected_fingerprint = (
                evidence["baselineSceneFingerprintSha256"]
                if expected_kind == "restored"
                else evidence["lockedSceneFingerprintSha256"]
            )
            if evidence["currentSceneFingerprintSha256"] != expected_fingerprint:
                raise ValueError("Shortcut proof native history fingerprint is invalid")
            self._validate_shortcut_native_observation(
                evidence[
                    "nativeUndoObservation"
                    if expected_kind == "restored"
                    else "nativeRedoObservation"
                ],
                id_field=(
                    "restorationObservationId"
                    if expected_kind == "restored"
                    else "redoObservationId"
                ),
                expected_fingerprint=expected_fingerprint,
                label=(
                    "Shortcut proof Undo observation"
                    if expected_kind == "restored"
                    else "Shortcut proof Redo observation"
                ),
            )
        return validated

    def _poll_shortcut_proof_request(self) -> None:
        response = self._request_json(
            "GET",
            "/api/v1/companion/shortcut-proof?" + urlencode({"adapterId": "blender", "instanceId": self._instance_id}),
            abort_on_stop=True,
        )
        self._validate_exact_keys(response, {"request"}, "Shortcut proof poll")
        delivery = response["request"]
        if delivery is None:
            return
        if isinstance(delivery, dict) and delivery.get("kind") in {
            "native_history_rebind", "native_terminal_reconcile"
        }:
            is_terminal = delivery.get("kind") == "native_terminal_reconcile"
            validated_recovery = (
                self._validate_shortcut_terminal_reconcile_delivery(delivery)
                if is_terminal
                else self._validate_shortcut_proof_recovery_delivery(delivery)
            )
            recovery_id = validated_recovery["recoveryId"]
            if recovery_id in self._seen_shortcut_proof_recovery_ids:
                return
            if len(self._seen_shortcut_proof_recovery_ids) >= 256:
                self._seen_shortcut_proof_recovery_ids.pop()
            self._seen_shortcut_proof_recovery_ids.add(recovery_id)
            self.incoming.put({
                "kind": (
                    "shortcut_proof_terminal_reconcile_request"
                    if is_terminal
                    else "shortcut_proof_recovery_request"
                ),
                "request": dict(validated_recovery),
            })
            return
        validated = self._validate_shortcut_proof_delivery(delivery)
        request_id = validated["requestId"]
        if request_id in self._seen_shortcut_proof_request_ids:
            return
        if len(self._seen_shortcut_proof_request_ids) >= 256:
            self._seen_shortcut_proof_request_ids.pop()
        self._seen_shortcut_proof_request_ids.add(request_id)
        self.incoming.put({"kind": "shortcut_proof_execute_request", "request": dict(validated)})

    def _validated_replay_current_state_request(
        self,
        value: Any,
    ) -> dict[str, Any] | None:
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ValueError("Replay current-state request must be an object or null")
        self._validate_exact_keys(
            value,
            {
                "formatVersion",
                "verificationId",
                "replayId",
                "attestationId",
                "attestationContentSha256",
                "target",
                "plan",
                "planContentSha256",
                "executionId",
                "stepId",
                "expectedPhase",
                "expectedCompletedStepIds",
                "expectedReceiptStepIds",
                "expectedCheckpoint",
                "expectedObservation",
                "requestedAt",
            },
            "Replay current-state request",
        )
        if value["formatVersion"] != "1.0.0":
            raise ValueError("Unsupported replay current-state request format")
        for key, label in (
            ("verificationId", "Verification id"),
            ("replayId", "Replay id"),
            ("attestationId", "Attestation id"),
            ("executionId", "Execution id"),
        ):
            self._validated_optional_uuid(value[key], label)
        for key, label in (
            ("attestationContentSha256", "Attestation content SHA-256"),
            ("planContentSha256", "Plan content SHA-256"),
        ):
            if (
                not isinstance(value[key], str)
                or CONTENT_SHA256_PATTERN.fullmatch(value[key]) is None
            ):
                raise ValueError(f"{label} must be 64 lowercase hex characters")
        target = value["target"]
        if not isinstance(target, dict):
            raise ValueError("Replay current-state target must be an object")
        self._validate_exact_keys(
            target,
            {"adapterId", "instanceId"},
            "Replay current-state target",
        )
        if target["adapterId"] != "blender" or target["instanceId"] != self._instance_id:
            raise ValueError("Replay current-state request targets a different Companion")
        self._validated_optional_uuid(target["instanceId"], "Target instance id")
        plan = value["plan"]
        if not isinstance(plan, dict):
            raise ValueError("Replay current-state plan must be an object")
        self._validate_exact_keys(plan, {"id", "revision"}, "Replay current-state plan")
        if not isinstance(plan["id"], str) or not plan["id"]:
            raise ValueError("Replay current-state plan id must be non-empty text")
        if (
            isinstance(plan["revision"], bool)
            or not isinstance(plan["revision"], int)
            or plan["revision"] <= 0
        ):
            raise ValueError("Replay current-state plan revision must be positive")
        if not isinstance(value["stepId"], str) or not value["stepId"]:
            raise ValueError("Replay current-state step id must be non-empty text")
        if value["expectedPhase"] not in {"running", "completed"}:
            raise ValueError(
                "Replay current-state expected phase must be running or completed"
            )
        completed_step_ids = value["expectedCompletedStepIds"]
        receipt_step_ids = value["expectedReceiptStepIds"]
        for step_ids, label in (
            (completed_step_ids, "completed-step prefix"),
            (receipt_step_ids, "receipt-step prefix"),
        ):
            if (
                not isinstance(step_ids, list)
                or not step_ids
                or any(not isinstance(step_id, str) or not step_id for step_id in step_ids)
                or len(set(step_ids)) != len(step_ids)
                or step_ids[-1] != value["stepId"]
            ):
                raise ValueError(
                    f"Replay current-state expected {label} must be unique and end with stepId"
                )
        previous_receipt_index = -1
        for step_id in receipt_step_ids:
            try:
                previous_receipt_index = completed_step_ids.index(
                    step_id,
                    previous_receipt_index + 1,
                )
            except ValueError as error:
                raise ValueError(
                    "Replay current-state receipt prefix must preserve completed-step order"
                ) from error
        expected_checkpoint = value["expectedCheckpoint"]
        if not isinstance(expected_checkpoint, dict):
            raise ValueError("Replay current-state expected checkpoint must be an object")
        self._validate_exact_keys(
            expected_checkpoint,
            {"checkpointId", "operation", "contentSha256"},
            "Replay current-state expected checkpoint",
        )
        self._validated_uuid(
            expected_checkpoint["checkpointId"],
            "Expected checkpoint id",
        )
        if expected_checkpoint["operation"] not in {"next", "recheck"}:
            raise ValueError(
                "Replay current-state expected checkpoint operation must be next or recheck"
            )
        if (
            not isinstance(expected_checkpoint["contentSha256"], str)
            or CONTENT_SHA256_PATTERN.fullmatch(expected_checkpoint["contentSha256"])
            is None
        ):
            raise ValueError(
                "Replay current-state expected checkpoint SHA-256 must be 64 lowercase hex characters"
            )
        expected_observation = value["expectedObservation"]
        if not isinstance(expected_observation, dict):
            raise ValueError("Replay current-state expected observation must be an object")
        self._validate_exact_keys(
            expected_observation,
            {"kind", "contentSha256"},
            "Replay current-state expected observation",
        )
        if (
            not isinstance(expected_observation["kind"], str)
            or not expected_observation["kind"]
        ):
            raise ValueError("Replay current-state observation kind must be non-empty text")
        if (
            not isinstance(expected_observation["contentSha256"], str)
            or CONTENT_SHA256_PATTERN.fullmatch(expected_observation["contentSha256"])
            is None
        ):
            raise ValueError(
                "Replay current-state observation SHA-256 must be 64 lowercase hex characters"
            )
        self._validate_expiry(value["requestedAt"], "Replay current-state requestedAt")
        return value

    @staticmethod
    def _validated_delivery_hash(
        value: Any,
        *,
        present: bool,
        label: str,
    ) -> str | None:
        if not present:
            if value is not None:
                raise ValueError(f"{label} must be null when its payload is absent")
            return None
        if not isinstance(value, str) or CONTENT_SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError(f"{label} must be 64 lowercase hex characters")
        return value

    def _poll_revision_history(self) -> None:
        thread_id = self._revision_thread_id
        if thread_id is None:
            return
        query_values = {
            "threadId": thread_id,
            "targetAdapterId": "blender",
            "instanceId": self._instance_id,
            "limit": "20",
        }
        requested_before_turn = self._revision_history_before_turn
        if requested_before_turn is not None:
            query_values["beforeTurn"] = str(requested_before_turn)
        query = urlencode(query_values)
        try:
            response = self._request_json(
                "GET",
                f"/api/v1/replan/thread?{query}",
                abort_on_stop=True,
            )
        except HTTPError as error:
            if error.code != 404:
                raise
            unavailable_signature = f"unavailable:{thread_id}"
            if self._revision_history_signature != unavailable_signature:
                self._revision_history_signature = unavailable_signature
                self.incoming.put(
                    {
                        "kind": "revision_thread_history_unavailable",
                        "message": "Runtime has no revision history for this thread",
                    }
                )
            if requested_before_turn is not None:
                self._revision_history_before_turn = None
            return
        if response.get("protocolVersion") not in SUPPORTED_PROTOCOL_VERSIONS:
            raise ValueError("Unsupported revision history protocol version")
        if response.get("threadId") != thread_id:
            raise ValueError("Runtime returned the wrong revision thread history")
        signature = json.dumps(response, sort_keys=True, separators=(",", ":"))
        if signature != self._revision_history_signature:
            self._revision_history_signature = signature
            self.incoming.put(
                {"kind": "revision_thread_history", "history": response}
            )
        if requested_before_turn is not None:
            self._revision_history_before_turn = None
            self._revision_history_signature = None

    def _poll_revision_branches(self) -> None:
        plan_id = self._known_plan_id
        if plan_id is None:
            return
        query = urlencode(
            {
                "targetAdapterId": "blender",
                "instanceId": self._instance_id,
                "planId": plan_id,
                "limit": "20",
            }
        )
        try:
            response = self._request_json(
                "GET",
                f"/api/v1/replan/branches?{query}",
                abort_on_stop=True,
            )
            if response.get("protocolVersion") not in EXECUTION_TRACK_PROTOCOL_VERSIONS:
                raise ValueError("Unsupported revision branch protocol version")
            if response.get("planId") != plan_id:
                raise ValueError("Runtime returned revision branches for the wrong Plan")
        except (
            HTTPError,
            HTTPException,
            OSError,
            ValueError,
            json.JSONDecodeError,
        ) as error:
            signature = f"unavailable:{plan_id}:{type(error).__name__}"
            if signature != self._revision_branches_signature:
                self._revision_branches_signature = signature
                self.incoming.put(
                    {
                        "kind": "revision_branch_list_unavailable",
                        "message": "Runtime revision branches are unavailable",
                    }
                )
            return
        signature = json.dumps(response, sort_keys=True, separators=(",", ":"))
        if signature != self._revision_branches_signature:
            self._revision_branches_signature = signature
            self.incoming.put(
                {"kind": "revision_branch_list", "branches": response}
            )

    def _poll_replan_run(self, generation_request_id: str) -> dict[str, Any]:
        response = self._request_json(
            "GET",
            "/api/v1/companion/replan-run?"
            + urlencode({"generationRequestId": generation_request_id}),
            abort_on_stop=True,
        )
        if response.get("generationRequestId") != generation_request_id:
            raise ValueError("Runtime returned the wrong replan run")
        return response

    def _poll_dialogue_run(self, dialogue_request_id: str) -> dict[str, Any]:
        response = self._request_json(
            "GET",
            "/api/v1/companion/dialogue-run?"
            + urlencode({"dialogueRequestId": dialogue_request_id}),
            abort_on_stop=True,
        )
        if response.get("dialogueRequestId") != dialogue_request_id:
            raise ValueError("Runtime returned the wrong dialogue run")
        return response

    def _poll_initial_plan_run(self, generation_request_id: str) -> dict[str, Any]:
        response = self._request_json(
            "GET",
            "/api/v1/companion/initial-plan-run?"
            + urlencode({"generationRequestId": generation_request_id}),
            abort_on_stop=True,
        )
        if response.get("generationRequestId") != generation_request_id:
            raise ValueError("Runtime returned the wrong initial-plan run")
        return response

    @staticmethod
    def _validate_replan_run_response(
        response: dict[str, Any], generation_request_id: Any
    ) -> str:
        if response.get("contractVersion") != "1.1.0":
            raise ValueError("Runtime returned an unsupported replan run contract")
        if response.get("generationRequestId") != generation_request_id:
            raise ValueError("Runtime returned the wrong replan run")
        status = response.get("status")
        if status not in REPLAN_RUN_STATUSES:
            raise ValueError("Runtime returned an unsupported replan run status")
        if response.get("terminal") is not (status in TERMINAL_REPLAN_RUN_STATUSES):
            raise ValueError("Runtime returned an inconsistent replan run status")
        return status

    @staticmethod
    def _validate_dialogue_run_response(
        response: dict[str, Any], dialogue_request_id: Any
    ) -> str:
        if response.get("dialogueRequestId") != dialogue_request_id:
            raise ValueError("Runtime returned the wrong dialogue run")
        status = response.get("status")
        if status not in DIALOGUE_RUN_STATUSES:
            raise ValueError("Runtime returned an unsupported dialogue status")
        if response.get("terminal") is not (
            status in TERMINAL_DIALOGUE_RUN_STATUSES
        ):
            raise ValueError("Runtime returned an inconsistent dialogue status")
        return status

    @staticmethod
    def _validate_initial_plan_run_response(
        response: dict[str, Any], generation_request_id: Any
    ) -> str:
        if response.get("generationRequestId") != generation_request_id:
            raise ValueError("Runtime returned the wrong initial-plan run")
        status = response.get("status")
        if status not in INITIAL_PLAN_RUN_STATUSES:
            raise ValueError("Runtime returned an unsupported initial-plan run status")
        if response.get("terminal") is not (
            status in TERMINAL_INITIAL_PLAN_RUN_STATUSES
        ):
            raise ValueError("Runtime returned an inconsistent initial-plan run status")
        return status

    def _run(self) -> None:
        next_poll = 0.0
        next_session_attempt_at = 0.0
        session_retry_delay = min(max(0.05, self._poll_interval), 5.0)
        pending_report: dict[str, Any] | None = None
        pending_action_result: dict[str, Any] | None = None
        pending_leaf_operation_result: dict[str, Any] | None = None
        pending_leaf_operation_recovery_ack: dict[str, Any] | None = None
        pending_poke_compound_result: dict[str, Any] | None = None
        pending_poke_compound_recovery_ack: dict[str, Any] | None = None
        pending_execution_track_preflight_create: dict[str, Any] | None = None
        pending_execution_track_preflight_status_request: str | None = None
        pending_execution_track_preflight_result: dict[str, Any] | None = None
        pending_execution_track_execution_progress: dict[str, Any] | None = None
        pending_execution_track_execution_managed_start: dict[str, Any] | None = None
        pending_execution_track_execution_result: dict[str, Any] | None = None
        pending_execution_track_execution_recovery_ack: dict[str, Any] | None = None
        stale_execution_track_execution_recovery_ack: dict[str, Any] | None = None
        pending_shortcut_progress: dict[str, Any] | None = None
        pending_shortcut_result: dict[str, Any] | None = None
        pending_shortcut_recovery_ack: dict[str, Any] | None = None
        pending_menu_control_progress: dict[str, Any] | None = None
        pending_menu_control_result: dict[str, Any] | None = None
        pending_menu_control_history_transition: dict[str, Any] | None = None
        pending_menu_control_recovery_ack: dict[str, Any] | None = None
        pending_decision: dict[str, Any] | None = None
        pending_revision_request: dict[str, Any] | None = None
        pending_goal_request: dict[str, Any] | None = None
        pending_replan_run: dict[str, Any] | None = None
        active_replan_run_id: str | None = None
        replan_run_signature: str | None = None
        pending_dialogue_run: dict[str, Any] | None = None
        active_dialogue_run_id: str | None = None
        dialogue_run_signature: str | None = None
        pending_initial_plan_run: dict[str, Any] | None = None
        active_initial_plan_run_id: str | None = None
        initial_plan_run_signature: str | None = None
        shortcut_reporting_blocked: set[str] = set()
        menu_control_reporting_blocked: set[str] = set()
        execution_track_reporting_blocked: set[str] = set()
        downgraded_preflight_identities: set[str] = set()
        refresh_replan_providers = True
        refresh_dialogue_providers = False
        refresh_initial_plan_providers = False
        decision_retry_at = 0.0
        decision_retry_delay = 0.05
        goal_retry_at = 0.0
        goal_retry_delay = 0.05
        last_error = ""
        while (
            not self._stop.is_set()
            or pending_report is not None
            or pending_action_result is not None
            or pending_leaf_operation_result is not None
            or pending_leaf_operation_recovery_ack is not None
            or pending_poke_compound_result is not None
            or pending_poke_compound_recovery_ack is not None
            or pending_execution_track_preflight_create is not None
            or pending_execution_track_preflight_status_request is not None
            or pending_execution_track_preflight_result is not None
            or pending_execution_track_execution_progress is not None
            or pending_execution_track_execution_managed_start is not None
            or pending_execution_track_execution_result is not None
            or pending_execution_track_execution_recovery_ack is not None
            or pending_shortcut_progress is not None
            or pending_shortcut_result is not None
            or pending_shortcut_recovery_ack is not None
            or pending_menu_control_progress is not None
            or pending_menu_control_result is not None
            or pending_menu_control_history_transition is not None
            or pending_menu_control_recovery_ack is not None
            or pending_decision is not None
            or pending_revision_request is not None
            or pending_goal_request is not None
            or pending_dialogue_run is not None
            or not self.outgoing.empty()
            or not self.action_results.empty()
            or not self.leaf_operation_results.empty()
            or not self.leaf_operation_recovery_acks.empty()
            or not self.poke_compound_results.empty()
            or not self.poke_compound_recovery_acks.empty()
            or not self.execution_track_preflight_creates.empty()
            or not self.execution_track_preflight_status_requests.empty()
            or not self.execution_track_preflight_results.empty()
            or not self.execution_track_execution_progress.empty()
            or not self.execution_track_execution_managed_starts.empty()
            or not self.execution_track_execution_results.empty()
            or not self.execution_track_execution_recovery_acks.empty()
            or not self.shortcut_proof_progress.empty()
            or not self.shortcut_proof_results.empty()
            or not self.shortcut_proof_recovery_acks.empty()
            or not self.menu_control_proof_progress.empty()
            or not self.menu_control_proof_results.empty()
            or not self.menu_control_proof_history_transitions.empty()
            or not self.menu_control_proof_recovery_acks.empty()
            or not self.decisions.empty()
            or not self.revision_requests.empty()
            or not self.goal_requests.empty()
            or not self.dialogue_runs.empty()
        ):
            if self._stop.is_set() and time.monotonic() >= self._flush_deadline:
                break
            try:
                request_succeeded = False
                now = time.monotonic()
                if (
                    self._session_snapshot is None
                    and not self._stop.is_set()
                    and now >= next_session_attempt_at
                ):
                    self._establish_session()
                    next_session_attempt_at = 0.0
                    session_retry_delay = min(max(0.05, self._poll_interval), 5.0)
                    request_succeeded = True
                now = time.monotonic()
                session = self._session_snapshot
                if session is None:
                    if self._stop.is_set():
                        time.sleep(0.01)
                    else:
                        retry_wait = max(0.0, next_session_attempt_at - now)
                        self._stop.wait(min(0.05, retry_wait))
                    continue
                if (
                    not self._stop.is_set()
                    and now >= session.next_heartbeat_at
                ):
                    self._send_heartbeat()
                    request_succeeded = True
                if self._service_lease_refresh_requests():
                    request_succeeded = True
                while True:
                    try:
                        control = self.control.get_nowait()
                    except Empty:
                        break
                    if control.get("kind") == "plan_accepted":
                        self._known_plan_id = str(control["planId"])
                        self._known_revision = int(control["revision"])
                        self._known_plan_content_sha256 = str(
                            control["planContentSha256"]
                        )
                        self._revision_branches_signature = None
                    elif control.get("kind") == "proposal_seen":
                        self._known_proposal_id = str(control["proposalId"])
                    elif control.get("kind") == "follow_revision_thread":
                        self._revision_thread_id = control.get("threadId")
                        self._revision_history_before_turn = None
                        self._revision_history_signature = None
                    elif control.get("kind") == "load_revision_history_before":
                        self._revision_history_before_turn = int(control["beforeTurn"])
                        self._revision_history_signature = None
                    elif control.get("kind") == "refresh_replan_providers":
                        refresh_replan_providers = True
                    elif control.get("kind") == "refresh_dialogue_providers":
                        refresh_dialogue_providers = True
                    elif control.get("kind") == "refresh_initial_plan_providers":
                        refresh_initial_plan_providers = True
                    elif control.get("kind") in {
                        "execution_track_execution_delivery_persisted",
                        "execution_track_execution_delivery_retry",
                    }:
                        request_id = control.get("requestId")
                        if isinstance(request_id, str):
                            self._apply_execution_track_execution_delivery_ack(
                                request_id,
                                persisted=control["kind"].endswith("_persisted"),
                            )
                    elif (
                        control.get("kind")
                        == "execution_track_execution_recovery_poll_enabled"
                    ):
                        self._execution_track_execution_recovery_poll_enabled = True
                if refresh_replan_providers and not self._stop.is_set():
                    try:
                        providers = self._request_json(
                            "GET", "/api/v1/replan/providers"
                        )
                    except (
                        HTTPError,
                        HTTPException,
                        OSError,
                        ValueError,
                        json.JSONDecodeError,
                    ) as error:
                        status_code = getattr(error, "code", None)
                        suffix = (
                            f" (HTTP {status_code})"
                            if isinstance(status_code, int)
                            else ""
                        )
                        self.incoming.put(
                            {
                                "kind": "replan_provider_list_unavailable",
                                "message": "Runtime provider discovery is unavailable"
                                + suffix,
                            }
                        )
                    else:
                        self.incoming.put(
                            {"kind": "replan_provider_list", "providers": providers}
                        )
                    refresh_replan_providers = False
                    request_succeeded = True
                if refresh_dialogue_providers and not self._stop.is_set():
                    try:
                        providers = self._request_json(
                            "GET", "/api/v1/dialogue/providers"
                        )
                    except (
                        HTTPError,
                        HTTPException,
                        OSError,
                        ValueError,
                        json.JSONDecodeError,
                    ) as error:
                        status_code = getattr(error, "code", None)
                        suffix = (
                            f" (HTTP {status_code})"
                            if isinstance(status_code, int)
                            else ""
                        )
                        self.incoming.put(
                            {
                                "kind": "dialogue_provider_list_unavailable",
                                "message": "Streamed dialogue provider discovery is unavailable"
                                + suffix,
                            }
                        )
                    else:
                        self.incoming.put(
                            {"kind": "dialogue_provider_list", "providers": providers}
                        )
                    refresh_dialogue_providers = False
                    request_succeeded = True
                if refresh_initial_plan_providers and not self._stop.is_set():
                    try:
                        providers = self._request_json(
                            "GET", "/api/v1/planner/providers"
                        )
                    except (
                        HTTPError,
                        HTTPException,
                        OSError,
                        ValueError,
                        json.JSONDecodeError,
                    ) as error:
                        status_code = getattr(error, "code", None)
                        suffix = (
                            f" (HTTP {status_code})"
                            if isinstance(status_code, int)
                            else ""
                        )
                        self.incoming.put(
                            {
                                "kind": "initial_plan_provider_list_unavailable",
                                "message": "Initial planner provider discovery is unavailable"
                                + suffix,
                            }
                        )
                    else:
                        self.incoming.put(
                            {
                                "kind": "initial_plan_provider_list",
                                "providers": providers,
                            }
                        )
                    refresh_initial_plan_providers = False
                    request_succeeded = True
                if pending_decision is None:
                    try:
                        pending_decision = self.decisions.get_nowait()
                    except Empty:
                        pass
                if (
                    pending_decision is not None
                    and time.monotonic() >= decision_retry_at
                ):
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/proposal-decision",
                            pending_decision,
                        )
                        if response.get("result") not in {"accepted", "duplicate"}:
                            raise ValueError(
                                "Runtime rejected or did not acknowledge proposal decision"
                            )
                    except (
                        HTTPError,
                        HTTPException,
                        OSError,
                        ValueError,
                        json.JSONDecodeError,
                    ) as error:
                        message = str(error)
                        if message != last_error:
                            self.incoming.put({"kind": "error", "message": message})
                            last_error = message
                        decision_retry_at = time.monotonic() + decision_retry_delay
                        decision_retry_delay = min(decision_retry_delay * 2, 2.0)
                    else:
                        self.incoming.put(
                            {
                                "kind": "proposal_decision_acknowledged",
                                "decision": dict(pending_decision),
                            }
                        )
                        request_succeeded = True
                        pending_decision = None
                        decision_retry_at = 0.0
                        decision_retry_delay = 0.05
                if pending_revision_request is None:
                    try:
                        pending_revision_request = self.revision_requests.get_nowait()
                    except Empty:
                        pass
                if pending_revision_request is not None:
                    response = self._request_json(
                        "POST",
                        "/api/v1/companion/revision-request",
                        pending_revision_request,
                    )
                    if response.get("result") not in {"accepted", "duplicate"}:
                        raise ValueError(
                            "Runtime rejected or did not acknowledge revision request"
                        )
                    request_id = pending_revision_request.get("requestId")
                    if response.get("requestId") != request_id:
                        raise ValueError("Runtime acknowledged the wrong revision request")
                    revision_thread = pending_revision_request.get("revisionThread")
                    if isinstance(revision_thread, dict):
                        thread_id = revision_thread.get("threadId")
                        if isinstance(thread_id, str):
                            self._revision_thread_id = self._validated_optional_uuid(
                                thread_id,
                                "Revision request thread id",
                            )
                            self._revision_history_signature = None
                    self.incoming.put(
                        {
                            "kind": "revision_request_acknowledged",
                            "requestId": request_id,
                        }
                    )
                    request_succeeded = True
                    pending_revision_request = None
                if pending_goal_request is None:
                    try:
                        pending_goal_request = self.goal_requests.get_nowait()
                    except Empty:
                        pass
                if (
                    pending_goal_request is not None
                    and time.monotonic() >= goal_retry_at
                ):
                    request_id = pending_goal_request.get("requestId")
                    self.incoming.put(
                        {"kind": "goal_request_delivering", "requestId": request_id}
                    )
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/goal-request",
                            pending_goal_request,
                        )
                        if response.get("result") not in {"accepted", "duplicate"}:
                            raise ValueError(
                                "Runtime rejected or did not acknowledge goal request"
                            )
                        if response.get("requestId") != request_id:
                            raise ValueError("Runtime acknowledged the wrong goal request")
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            message = str(error)
                            if message != last_error:
                                self.incoming.put({"kind": "error", "message": message})
                                last_error = message
                            goal_retry_at = time.monotonic() + goal_retry_delay
                            goal_retry_delay = min(goal_retry_delay * 2, 2.0)
                        else:
                            error_payload = getattr(error, "runtime_payload", {})
                            detail = (
                                error_payload.get("message")
                                if isinstance(error_payload, dict)
                                else None
                            )
                            self.incoming.put(
                                {
                                    "kind": "goal_request_rejected",
                                    "requestId": request_id,
                                    "message": (
                                        detail
                                        if isinstance(detail, str) and detail.strip()
                                        else f"Runtime permanently rejected goal request (HTTP {error.code})"
                                    ),
                                }
                            )
                            pending_goal_request = None
                            goal_retry_at = 0.0
                            goal_retry_delay = 0.05
                            request_succeeded = True
                    except (
                        HTTPException,
                        OSError,
                        ValueError,
                        json.JSONDecodeError,
                    ) as error:
                        message = str(error)
                        if message != last_error:
                            self.incoming.put({"kind": "error", "message": message})
                            last_error = message
                        goal_retry_at = time.monotonic() + goal_retry_delay
                        goal_retry_delay = min(goal_retry_delay * 2, 2.0)
                    else:
                        self.incoming.put(
                            {"kind": "goal_request_acknowledged", "requestId": request_id}
                        )
                        pending_goal_request = None
                        goal_retry_at = 0.0
                        goal_retry_delay = 0.05
                        request_succeeded = True
                if not self._stop.is_set() and pending_replan_run is None:
                    try:
                        pending_replan_run = self.replan_runs.get_nowait()
                    except Empty:
                        pass
                if not self._stop.is_set() and pending_replan_run is not None:
                    generation_request_id = pending_replan_run.get(
                        "generationRequestId"
                    )
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/replan-run",
                            pending_replan_run,
                        )
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        error_payload = getattr(error, "runtime_payload", {})
                        message = (
                            error_payload.get("message")
                            if isinstance(error_payload, dict)
                            else None
                        )
                        self.incoming.put(
                            {
                                "kind": "replan_run_rejected",
                                "generationRequestId": generation_request_id,
                                "message": (
                                    message
                                    if isinstance(message, str) and message.strip()
                                    else "Runtime rejected this provider authorization"
                                ),
                            }
                        )
                        pending_replan_run = None
                        request_succeeded = True
                        continue
                    status = self._validate_replan_run_response(
                        response, generation_request_id
                    )
                    self.incoming.put(
                        {"kind": "replan_run_status", "run": response}
                    )
                    if status in TERMINAL_REPLAN_RUN_STATUSES:
                        active_replan_run_id = None
                        replan_run_signature = None
                    else:
                        active_replan_run_id = str(generation_request_id)
                        replan_run_signature = json.dumps(
                            response, sort_keys=True, separators=(",", ":")
                        )
                    pending_replan_run = None
                    request_succeeded = True
                if not self._stop.is_set() and pending_dialogue_run is None:
                    try:
                        pending_dialogue_run = self.dialogue_runs.get_nowait()
                    except Empty:
                        pass
                if not self._stop.is_set() and pending_dialogue_run is not None:
                    dialogue_request_id = pending_dialogue_run.get(
                        "dialogueRequestId"
                    )
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/dialogue-run",
                            pending_dialogue_run,
                        )
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        error_payload = getattr(error, "runtime_payload", {})
                        message = (
                            error_payload.get("message")
                            if isinstance(error_payload, dict)
                            else None
                        )
                        self.incoming.put(
                            {
                                "kind": "dialogue_run_rejected",
                                "dialogueRequestId": dialogue_request_id,
                                "message": (
                                    message
                                    if isinstance(message, str) and message.strip()
                                    else "Runtime rejected this dialogue authorization"
                                ),
                            }
                        )
                        pending_dialogue_run = None
                        request_succeeded = True
                        continue
                    status = self._validate_dialogue_run_response(
                        response, dialogue_request_id
                    )
                    self.incoming.put(
                        {"kind": "dialogue_run_status", "run": response}
                    )
                    if status in TERMINAL_DIALOGUE_RUN_STATUSES:
                        active_dialogue_run_id = None
                        dialogue_run_signature = None
                    else:
                        active_dialogue_run_id = str(dialogue_request_id)
                        dialogue_run_signature = json.dumps(
                            response, sort_keys=True, separators=(",", ":")
                        )
                    pending_dialogue_run = None
                    request_succeeded = True
                if not self._stop.is_set() and pending_initial_plan_run is None:
                    try:
                        pending_initial_plan_run = self.initial_plan_runs.get_nowait()
                    except Empty:
                        pass
                if not self._stop.is_set() and pending_initial_plan_run is not None:
                    generation_request_id = pending_initial_plan_run.get(
                        "generationRequestId"
                    )
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/initial-plan-run",
                            pending_initial_plan_run,
                        )
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        error_payload = getattr(error, "runtime_payload", {})
                        message = (
                            error_payload.get("message")
                            if isinstance(error_payload, dict)
                            else None
                        )
                        self.incoming.put(
                            {
                                "kind": "initial_plan_run_rejected",
                                "generationRequestId": generation_request_id,
                                "message": (
                                    message
                                    if isinstance(message, str) and message.strip()
                                    else "Runtime rejected this initial planner authorization"
                                ),
                            }
                        )
                        pending_initial_plan_run = None
                        request_succeeded = True
                        continue
                    status = self._validate_initial_plan_run_response(
                        response, generation_request_id
                    )
                    self.incoming.put(
                        {"kind": "initial_plan_run_status", "run": response}
                    )
                    if status in TERMINAL_INITIAL_PLAN_RUN_STATUSES:
                        active_initial_plan_run_id = None
                        initial_plan_run_signature = None
                    else:
                        active_initial_plan_run_id = str(generation_request_id)
                        initial_plan_run_signature = json.dumps(
                            response, sort_keys=True, separators=(",", ":")
                        )
                    pending_initial_plan_run = None
                    request_succeeded = True
                if pending_report is None:
                    try:
                        pending_report = self.outgoing.get_nowait()
                    except Empty:
                        pass
                if pending_report is not None:
                    response = self._request_json(
                        "POST", "/api/v1/companion/state", pending_report
                    )
                    if response.get("result") not in {"accepted", "duplicate"}:
                        raise ValueError("Runtime rejected or did not acknowledge state report")
                    request_succeeded = True
                    sequence = pending_report.get("sequence")
                    report_id = pending_report.get("reportId")
                    previous_sequence = self._last_delivered_sequence
                    if isinstance(sequence, int) and not isinstance(sequence, bool):
                        self._last_delivered_sequence = max(
                            self._last_delivered_sequence, sequence
                        )
                    if (
                        isinstance(report_id, str)
                        and isinstance(sequence, int)
                        and not isinstance(sequence, bool)
                        and sequence >= previous_sequence
                    ):
                        self._last_delivered_report_identity = (report_id, sequence)
                    pending_report = None
                if pending_action_result is None:
                    try:
                        pending_action_result = self.action_results.get_nowait()
                    except Empty:
                        pass
                if pending_action_result is not None:
                    result_report = pending_action_result.get("report")
                    report_identity = (
                        (
                            result_report.get("reportId"),
                            result_report.get("sequence"),
                        )
                        if (
                            isinstance(result_report, dict)
                            and isinstance(result_report.get("reportId"), str)
                            and isinstance(result_report.get("sequence"), int)
                            and not isinstance(result_report.get("sequence"), bool)
                        )
                        else None
                    )
                    if (
                        result_report is None
                        or (
                            report_identity is not None
                            and report_identity == self._last_delivered_report_identity
                            and report_identity[1] == self._last_delivered_sequence
                        )
                    ):
                        request_id = pending_action_result.get("requestId")
                        try:
                            response = self._request_json(
                                "POST",
                                "/api/v1/companion/action-result",
                                pending_action_result,
                            )
                            self._validate_exact_keys(
                                response, {"result"}, "Action execution result ack"
                            )
                            if response["result"] not in {"accepted", "duplicate"}:
                                raise ValueError(
                                    "Runtime rejected or did not acknowledge action result"
                                )
                        except HTTPError as error:
                            if not 400 <= error.code < 500:
                                raise
                            self.incoming.put(
                                {
                                    "kind": "action_result_rejected",
                                    "requestId": request_id,
                                    "message": (
                                        "Runtime permanently rejected action result "
                                        f"(HTTP {error.code})"
                                    ),
                                }
                            )
                            pending_action_result = None
                            request_succeeded = True
                        else:
                            self.incoming.put(
                                {
                                    "kind": "action_result_acknowledged",
                                    "requestId": request_id,
                                }
                            )
                            pending_action_result = None
                            request_succeeded = True
                if pending_leaf_operation_result is None:
                    try:
                        pending_leaf_operation_result = (
                            self.leaf_operation_results.get_nowait()
                        )
                    except Empty:
                        pass
                if pending_leaf_operation_result is not None:
                    final_report = pending_leaf_operation_result.get("progress")
                    final_report = (
                        final_report.get("finalReport")
                        if isinstance(final_report, dict)
                        else None
                    )
                    report_identity = (
                        (final_report.get("reportId"), final_report.get("sequence"))
                        if (
                            isinstance(final_report, dict)
                            and isinstance(final_report.get("reportId"), str)
                            and isinstance(final_report.get("sequence"), int)
                            and not isinstance(final_report.get("sequence"), bool)
                        )
                        else None
                    )
                    if (
                        final_report is None
                        or (
                            report_identity is not None
                            and report_identity == self._last_delivered_report_identity
                            and report_identity[1] == self._last_delivered_sequence
                        )
                    ):
                        request_id = pending_leaf_operation_result.get("requestId")
                        try:
                            response = self._request_json(
                                "POST",
                                "/api/v1/companion/leaf-operation-result",
                                pending_leaf_operation_result,
                            )
                            self._validate_exact_keys(
                                response, {"result"}, "Leaf-operation result ack"
                            )
                            if response["result"] not in {"accepted", "duplicate"}:
                                raise ValueError(
                                    "Runtime rejected or did not acknowledge leaf-operation result"
                                )
                        except HTTPError as error:
                            if self._leaf_operation_result_requires_session_retry(error):
                                raise
                            if not 400 <= error.code < 500:
                                raise
                            self.incoming.put(
                                {
                                    "kind": "leaf_operation_result_rejected",
                                    "requestId": request_id,
                                    "message": (
                                        "Runtime permanently rejected leaf-operation result "
                                        f"(HTTP {error.code})"
                                    ),
                                }
                            )
                            pending_leaf_operation_result = None
                            request_succeeded = True
                        else:
                            recovery_required = (
                                pending_leaf_operation_result.get("status")
                                == "recovery_required"
                            )
                            self.incoming.put(
                                {
                                    "kind": "leaf_operation_result_acknowledged",
                                    "requestId": request_id,
                                }
                            )
                            pending_leaf_operation_result = None
                            request_succeeded = True
                            if recovery_required:
                                # A challenge must be issued to a replacement lease.  Preserve
                                # the document/session identity while rotating only live authority.
                                self._clear_session()
                                continue
                if pending_leaf_operation_recovery_ack is None:
                    try:
                        pending_leaf_operation_recovery_ack = (
                            self.leaf_operation_recovery_acks.get_nowait()
                        )
                    except Empty:
                        pass
                if pending_leaf_operation_recovery_ack is not None:
                    request_id = pending_leaf_operation_recovery_ack.get("requestId")
                    recovery_id = pending_leaf_operation_recovery_ack.get("recoveryId")
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/leaf-operation-recovery",
                            pending_leaf_operation_recovery_ack,
                        )
                        self._validate_exact_keys(
                            response,
                            {"result"},
                            "Leaf-operation recovery acknowledgement response",
                        )
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError(
                                "Runtime did not acknowledge leaf-operation recovery"
                            )
                    except HTTPError as error:
                        if self._leaf_operation_recovery_ack_requires_new_challenge(error):
                            # Authorization happens before the ACK commit.  This response
                            # therefore proves the old challenge was not acknowledged; keep
                            # any Native Undo witness, rotate the lease, and await a fresh
                            # challenge instead of replaying the stale ACK.
                            pending_leaf_operation_recovery_ack = None
                            raise
                        if not 400 <= error.code < 500:
                            raise
                        self.incoming.put(
                            {
                                "kind": "leaf_operation_recovery_rejected",
                                "requestId": request_id,
                                "recoveryId": recovery_id,
                                "message": (
                                    "Runtime rejected the leaf-operation recovery proof "
                                    f"(HTTP {error.code})"
                                ),
                            }
                        )
                        pending_leaf_operation_recovery_ack = None
                        request_succeeded = True
                    else:
                        outcome = pending_leaf_operation_recovery_ack.get("outcome")
                        self.incoming.put(
                            {
                                "kind": "leaf_operation_recovery_acknowledged",
                                "requestId": request_id,
                                "recoveryId": recovery_id,
                                "outcome": outcome,
                            }
                        )
                        pending_leaf_operation_recovery_ack = None
                        request_succeeded = True
                        if outcome == "unresolved_current_state":
                            # The next read-only attempt receives a new challenge on another
                            # lease; the target remains locked throughout the rotation.
                            self._clear_session()
                            continue
                if pending_poke_compound_result is None:
                    try:
                        pending_poke_compound_result = self.poke_compound_results.get_nowait()
                    except Empty:
                        pass
                if pending_poke_compound_result is not None:
                    request_id = pending_poke_compound_result.get("requestId")
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/poke-compound-result",
                            pending_poke_compound_result,
                        )
                        self._validate_exact_keys(
                            response, {"result"}, "Poke compound result acknowledgement"
                        )
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError(
                                "Runtime rejected or did not acknowledge Poke compound result"
                            )
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        self.incoming.put(
                            {
                                "kind": "poke_compound_result_rejected",
                                "requestId": request_id,
                                "message": (
                                    "Runtime permanently rejected Poke compound result "
                                    f"(HTTP {error.code})"
                                ),
                            }
                        )
                        pending_poke_compound_result = None
                        request_succeeded = True
                    else:
                        self.incoming.put(
                            {
                                "kind": "poke_compound_result_acknowledged",
                                "requestId": request_id,
                            }
                        )
                        pending_poke_compound_result = None
                        request_succeeded = True
                if pending_poke_compound_recovery_ack is None:
                    try:
                        pending_poke_compound_recovery_ack = (
                            self.poke_compound_recovery_acks.get_nowait()
                        )
                    except Empty:
                        pass
                if pending_poke_compound_recovery_ack is not None:
                    recovery_id = pending_poke_compound_recovery_ack.get("recoveryId")
                    challenge = pending_poke_compound_recovery_ack.get("challenge")
                    delivery = (
                        challenge.get("originalDelivery")
                        if isinstance(challenge, dict)
                        else None
                    )
                    request_id = (
                        delivery.get("requestId") if isinstance(delivery, dict) else None
                    )
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/poke-compound-recovery",
                            pending_poke_compound_recovery_ack,
                        )
                        self._validate_exact_keys(
                            response,
                            {"result"},
                            "Poke compound recovery acknowledgement response",
                        )
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError(
                                "Runtime did not acknowledge Poke compound recovery"
                            )
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        self.incoming.put(
                            {
                                "kind": "poke_compound_recovery_rejected",
                                "requestId": request_id,
                                "recoveryId": recovery_id,
                                "message": (
                                    "Runtime rejected the Poke compound recovery proof "
                                    f"(HTTP {error.code})"
                                ),
                            }
                        )
                        pending_poke_compound_recovery_ack = None
                        request_succeeded = True
                    else:
                        self.incoming.put(
                            {
                                "kind": "poke_compound_recovery_acknowledged",
                                "requestId": request_id,
                                "recoveryId": recovery_id,
                                "outcome": pending_poke_compound_recovery_ack.get("outcome"),
                            }
                        )
                        pending_poke_compound_recovery_ack = None
                        request_succeeded = True
                if pending_execution_track_preflight_create is None:
                    try:
                        pending_execution_track_preflight_create = (
                            self.execution_track_preflight_creates.get_nowait()
                        )
                    except Empty:
                        pass
                if pending_execution_track_preflight_create is not None:
                    request_id = pending_execution_track_preflight_create.get("requestId")
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/execution-track-preflight",
                            pending_execution_track_preflight_create,
                        )
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        self.incoming.put(
                            {
                                "kind": "execution_track_preflight_create_rejected",
                                "requestId": request_id,
                                "message": (
                                    "Runtime permanently rejected execution-track "
                                    f"preflight creation (HTTP {error.code})"
                                ),
                            }
                        )
                    else:
                        self._execution_track_preflight_poll_enabled = (
                            response.get("status") == "queued"
                        )
                        self.incoming.put(
                            {
                                "kind": "execution_track_preflight_status",
                                "requestId": request_id,
                                "status": deepcopy(response),
                            }
                        )
                    pending_execution_track_preflight_create = None
                    request_succeeded = True
                if pending_execution_track_preflight_status_request is None:
                    try:
                        pending_execution_track_preflight_status_request = (
                            self.execution_track_preflight_status_requests.get_nowait()
                        )
                    except Empty:
                        pass
                if pending_execution_track_preflight_status_request is not None:
                    request_id = pending_execution_track_preflight_status_request
                    response = self._request_json(
                        "GET",
                        "/api/v1/companion/execution-track-preflight?"
                        + urlencode({"requestId": request_id}),
                    )
                    self.incoming.put(
                        {
                            "kind": "execution_track_preflight_status",
                            "requestId": request_id,
                            "status": deepcopy(response),
                        }
                    )
                    pending_execution_track_preflight_status_request = None
                    request_succeeded = True
                if pending_execution_track_preflight_result is None:
                    try:
                        pending_execution_track_preflight_result = (
                            self.execution_track_preflight_results.get_nowait()
                        )
                    except Empty:
                        pass
                if pending_execution_track_preflight_result is not None:
                    request_id = pending_execution_track_preflight_result.get("requestId")
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/execution-track-preflight/result",
                            pending_execution_track_preflight_result,
                        )
                        self._validate_exact_keys(
                            response, {"result"}, "Execution-track preflight result ack"
                        )
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError(
                                "Runtime did not acknowledge execution-track preflight result"
                            )
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        downgraded = self._downgrade_verified_preflight_authority_change(
                            pending_execution_track_preflight_result, error
                        )
                        identity_sha256 = (
                            self._canonical_sha256(
                                self._execution_track_preflight_result_identity(
                                    pending_execution_track_preflight_result
                                )
                            )
                            if downgraded is not None
                            else None
                        )
                        if (
                            downgraded is not None
                            and identity_sha256 is not None
                            and identity_sha256 not in downgraded_preflight_identities
                        ):
                            downgraded_preflight_identities.add(identity_sha256)
                            pending_execution_track_preflight_result = downgraded
                            continue
                        self.incoming.put(
                            {
                                "kind": "execution_track_preflight_result_rejected",
                                "requestId": request_id,
                                "message": (
                                    "Runtime permanently rejected execution-track "
                                    f"preflight result (HTTP {error.code})"
                                ),
                            }
                        )
                    else:
                        self._execution_track_preflight_poll_enabled = False
                        if isinstance(request_id, str):
                            self.execution_track_preflight_status_requests.put(request_id)
                        self.incoming.put(
                            {
                                "kind": "execution_track_preflight_result_acknowledged",
                                "requestId": request_id,
                                "result": response["result"],
                            }
                        )
                    pending_execution_track_preflight_result = None
                    request_succeeded = True
                if pending_execution_track_execution_progress is None:
                    try:
                        pending_execution_track_execution_progress = (
                            self.execution_track_execution_progress.get_nowait()
                        )
                    except Empty:
                        pass
                if pending_execution_track_execution_progress is not None:
                    request_id = pending_execution_track_execution_progress.get("requestId")
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/execution-track-execution/progress",
                            pending_execution_track_execution_progress,
                        )
                        self._validate_exact_keys(
                            response, {"result"}, "Execution-track progress ack"
                        )
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError("Runtime did not acknowledge execution-track progress")
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        if isinstance(request_id, str):
                            execution_track_reporting_blocked.add(request_id)
                        self.incoming.put(
                            {
                                "kind": "execution_track_execution_progress_rejected",
                                "requestId": request_id,
                                "progressContentSha256": (
                                    pending_execution_track_execution_progress.get(
                                        "contentSha256"
                                    )
                                ),
                                "message": (
                                    "Runtime permanently rejected execution-track baseline "
                                    f"progress (HTTP {error.code})"
                                ),
                            }
                        )
                    else:
                        self.incoming.put(
                            {
                                "kind": "execution_track_execution_progress_acknowledged",
                                "requestId": request_id,
                                "progressContentSha256": (
                                    pending_execution_track_execution_progress.get(
                                        "contentSha256"
                                    )
                                ),
                                "result": response["result"],
                            }
                        )
                    pending_execution_track_execution_progress = None
                    request_succeeded = True
                if pending_execution_track_execution_managed_start is None:
                    try:
                        pending_execution_track_execution_managed_start = (
                            self.execution_track_execution_managed_starts.get_nowait()
                        )
                    except Empty:
                        pass
                if pending_execution_track_execution_managed_start is not None:
                    request_id = pending_execution_track_execution_managed_start.get(
                        "requestId"
                    )
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/execution-track-execution/managed-start",
                            pending_execution_track_execution_managed_start,
                        )
                        self._validate_exact_keys(
                            response, {"result"}, "Execution-track managed-start ack"
                        )
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError(
                                "Runtime did not acknowledge execution-track managed start"
                            )
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        self.incoming.put(
                            {
                                "kind": "execution_track_execution_managed_start_rejected",
                                "requestId": request_id,
                                "managedStartContentSha256": (
                                    pending_execution_track_execution_managed_start.get(
                                        "managedStart", {}
                                    ).get("contentSha256")
                                ),
                                "message": (
                                    "Runtime permanently rejected execution-track managed "
                                    f"start (HTTP {error.code})"
                                ),
                            }
                        )
                    else:
                        self.incoming.put(
                            {
                                "kind": "execution_track_execution_managed_start_acknowledged",
                                "requestId": request_id,
                                "managedStartContentSha256": (
                                    pending_execution_track_execution_managed_start.get(
                                        "managedStart", {}
                                    ).get("contentSha256")
                                ),
                                "result": response["result"],
                            }
                        )
                    pending_execution_track_execution_managed_start = None
                    request_succeeded = True
                if pending_execution_track_execution_result is None:
                    try:
                        pending_execution_track_execution_result = (
                            self.execution_track_execution_results.get_nowait()
                        )
                    except Empty:
                        pass
                if pending_execution_track_execution_result is not None:
                    request_id = pending_execution_track_execution_result.get("requestId")
                    if request_id in execution_track_reporting_blocked:
                        pending_execution_track_execution_result = None
                        request_succeeded = True
                    else:
                        try:
                            response = self._request_json(
                                "POST",
                                "/api/v1/companion/execution-track-execution/result",
                                pending_execution_track_execution_result,
                            )
                            self._validate_exact_keys(
                                response, {"result"}, "Execution-track result ack"
                            )
                            if response["result"] not in {"accepted", "duplicate"}:
                                raise ValueError("Runtime did not acknowledge execution-track result")
                        except HTTPError as error:
                            runtime_payload = getattr(error, "runtime_payload", None)
                            if (
                                error.code == 409
                                and isinstance(runtime_payload, dict)
                                and runtime_payload.get("retryable") is True
                            ):
                                raise
                            if not 400 <= error.code < 500:
                                raise
                            self.incoming.put(
                                {
                                    "kind": "execution_track_execution_result_rejected",
                                    "requestId": request_id,
                                    "message": (
                                        "Runtime permanently rejected execution-track result "
                                        f"(HTTP {error.code})"
                                    ),
                                }
                            )
                            pending_execution_track_execution_result = None
                        else:
                            self.incoming.put(
                                {
                                    "kind": "execution_track_execution_result_acknowledged",
                                    "requestId": request_id,
                                    "result": response["result"],
                                }
                            )
                            pending_execution_track_execution_result = None
                        request_succeeded = True
                if pending_execution_track_execution_recovery_ack is None:
                    while True:
                        try:
                            candidate_recovery_ack = (
                                self.execution_track_execution_recovery_acks.get_nowait()
                            )
                        except Empty:
                            break
                        stale_recovery_id = (
                            stale_execution_track_execution_recovery_ack.get("recoveryId")
                            if isinstance(
                                stale_execution_track_execution_recovery_ack, dict
                            )
                            else None
                        )
                        stale_request_id = (
                            stale_execution_track_execution_recovery_ack.get("requestId")
                            if isinstance(
                                stale_execution_track_execution_recovery_ack, dict
                            )
                            else None
                        )
                        if (
                            stale_execution_track_execution_recovery_ack is not None
                            and (
                                candidate_recovery_ack.get("requestId")
                                != stale_request_id
                                or candidate_recovery_ack.get("recoveryId")
                                == stale_recovery_id
                            )
                        ):
                            continue
                        pending_execution_track_execution_recovery_ack = (
                            candidate_recovery_ack
                        )
                        stale_execution_track_execution_recovery_ack = None
                        break
                if pending_execution_track_execution_recovery_ack is not None:
                    request_id = pending_execution_track_execution_recovery_ack.get("requestId")
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/execution-track-execution/recovery",
                            pending_execution_track_execution_recovery_ack,
                        )
                        self._validate_exact_keys(
                            response, {"result"}, "Execution-track recovery ack"
                        )
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError("Runtime did not acknowledge execution-track recovery")
                    except HTTPError as error:
                        runtime_code = self._runtime_error_code(
                            getattr(error, "runtime_payload", {})
                        )
                        rotated_authority_codes = {
                            "lease_not_current",
                            "execution_track_execution_recovery_state_not_current",
                            "execution_track_execution_recovery_live_authority",
                            "execution_track_execution_recovery_ack_challenge",
                        }
                        if error.code != 409 or runtime_code not in rotated_authority_codes:
                            raise
                        stale_execution_track_execution_recovery_ack = (
                            pending_execution_track_execution_recovery_ack
                        )
                        pending_execution_track_execution_recovery_ack = None
                        self._execution_track_execution_recovery_poll_enabled = True
                        self.incoming.put(
                            {
                                "kind": (
                                    "execution_track_execution_recovery_ack_"
                                    "supersession_required"
                                ),
                                "requestId": request_id,
                                "recoveryId": (
                                    stale_execution_track_execution_recovery_ack.get(
                                        "recoveryId"
                                    )
                                ),
                                "runtimeCode": runtime_code,
                            }
                        )
                    else:
                        self._execution_track_execution_recovery_poll_enabled = False
                        self.incoming.put(
                            {
                                "kind": "execution_track_execution_recovery_acknowledged",
                                "requestId": request_id,
                                "result": response["result"],
                            }
                        )
                        pending_execution_track_execution_recovery_ack = None
                    request_succeeded = True
                if pending_menu_control_progress is None:
                    try:
                        pending_menu_control_progress = self.menu_control_proof_progress.get_nowait()
                    except Empty:
                        pass
                if pending_menu_control_progress is not None:
                    request_id = pending_menu_control_progress.get("requestId")
                    if request_id in menu_control_reporting_blocked:
                        pending_menu_control_progress = None
                        request_succeeded = True
                        continue
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/menu-control-proof-progress",
                            pending_menu_control_progress,
                        )
                        self._validate_exact_keys(response, {"result"}, "Menu-control proof progress ack")
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError("Runtime did not acknowledge menu-control proof progress")
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        self.incoming.put({
                            "kind": "menu_control_proof_progress_rejected",
                            "requestId": request_id,
                            "message": f"Runtime permanently rejected menu-control proof progress (HTTP {error.code})",
                        })
                        pending_menu_control_progress = None
                        if isinstance(request_id, str):
                            menu_control_reporting_blocked.add(request_id)
                        request_succeeded = True
                    else:
                        self.incoming.put({
                            "kind": "menu_control_proof_progress_acknowledged",
                            "requestId": request_id,
                            "receiptChainHeadSha256": pending_menu_control_progress.get("receiptChainHeadSha256"),
                        })
                        pending_menu_control_progress = None
                        request_succeeded = True
                menu_control_progress_backlog = (
                    pending_menu_control_progress is not None
                    or not self.menu_control_proof_progress.empty()
                )
                if pending_menu_control_result is None and not menu_control_progress_backlog:
                    try:
                        pending_menu_control_result = self.menu_control_proof_results.get_nowait()
                    except Empty:
                        pass
                if pending_menu_control_result is not None and not menu_control_progress_backlog:
                    request_id = pending_menu_control_result.get("requestId")
                    if request_id in menu_control_reporting_blocked:
                        pending_menu_control_result = None
                        self._menu_control_proof_inflight_request_id = None
                        request_succeeded = True
                        continue
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/menu-control-proof-result",
                            pending_menu_control_result,
                        )
                        self._validate_exact_keys(response, {"result"}, "Menu-control proof result ack")
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError("Runtime did not acknowledge menu-control proof result")
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        self.incoming.put({
                            "kind": "menu_control_proof_result_rejected",
                            "requestId": request_id,
                            "message": f"Runtime permanently rejected menu-control proof result (HTTP {error.code})",
                        })
                        pending_menu_control_result = None
                        if isinstance(request_id, str):
                            menu_control_reporting_blocked.add(request_id)
                        self._menu_control_proof_inflight_request_id = None
                        request_succeeded = True
                    else:
                        self.incoming.put({
                            "kind": "menu_control_proof_result_acknowledged",
                            "requestId": request_id,
                            "resultContentSha256": self._canonical_sha256(pending_menu_control_result),
                        })
                        pending_menu_control_result = None
                        self._menu_control_proof_inflight_request_id = None
                        request_succeeded = True
                session = self._session_snapshot
                menu_control_recovery_ack_delivery_allowed = (
                    session is not None
                    and (
                        self._menu_control_recovery_barrier_lease_id
                        != session.lease_id
                        or self._menu_control_recovery_discovery_lease_id
                        == session.lease_id
                    )
                )
                if (
                    pending_menu_control_recovery_ack is None
                    and menu_control_recovery_ack_delivery_allowed
                ):
                    try:
                        pending_menu_control_recovery_ack = (
                            self.menu_control_proof_recovery_acks.get_nowait()
                        )
                    except Empty:
                        pass
                if (
                    pending_menu_control_recovery_ack is not None
                    and menu_control_recovery_ack_delivery_allowed
                ):
                    result = pending_menu_control_recovery_ack.get("result")
                    request_id = (
                        result.get("requestId")
                        if isinstance(result, dict)
                        else pending_menu_control_recovery_ack.get("requestId")
                    )
                    recovery_id = pending_menu_control_recovery_ack.get("recoveryId")
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/menu-control-proof-recovery",
                            pending_menu_control_recovery_ack,
                        )
                        self._validate_exact_keys(
                            response,
                            {"result"},
                            "Menu-control proof recovery acknowledgement",
                        )
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError(
                                "Runtime did not acknowledge menu-control proof recovery"
                            )
                    except HTTPError as error:
                        error_payload = getattr(error, "runtime_payload", {})
                        runtime_code = self._runtime_error_code(error_payload)
                        stale_codes = {
                            "menu_control_proof_history_reconciliation_challenge_stale",
                            "menu_control_proof_terminal_reconciliation_challenge_stale",
                        }
                        if error.code == 409 and runtime_code in stale_codes:
                            if isinstance(recovery_id, str):
                                self._menu_control_proof_reconciliations.pop(
                                    recovery_id, None
                                )
                                self._seen_menu_control_proof_recovery_ids.discard(
                                    recovery_id
                                )
                            pending_menu_control_recovery_ack = None
                            session = self._session_snapshot
                            if session is not None:
                                self._menu_control_recovery_discovery_lease_id = None
                                self._menu_control_recovery_barrier_lease_id = (
                                    session.lease_id
                                )
                            request_succeeded = True
                            continue
                        transient_codes = {"lease_not_current"}
                        if (
                            not 400 <= error.code < 500
                            or (
                                error.code == 409
                                and runtime_code in transient_codes
                            )
                        ):
                            raise
                        self.incoming.put(
                            {
                                "kind": "menu_control_proof_recovery_rejected",
                                "requestId": request_id,
                                "recoveryId": recovery_id,
                                "runtimeCode": runtime_code,
                                "runtimePayload": deepcopy(error_payload),
                                "message": (
                                    error_payload.get("message")
                                    if isinstance(error_payload, dict)
                                    and isinstance(error_payload.get("message"), str)
                                    else "Runtime permanently rejected menu-control proof recovery "
                                    f"(HTTP {error.code})"
                                ),
                            }
                        )
                        pending_menu_control_recovery_ack = None
                        request_succeeded = True
                    else:
                        transition_hashes = list(
                            pending_menu_control_recovery_ack.get(
                                "transitionContentSha256s", []
                            )
                        )
                        challenge = self._menu_control_proof_reconciliations.get(
                            recovery_id
                        )
                        challenge_replacement_lease = (
                            challenge.get("replacementLease")
                            if isinstance(challenge, dict)
                            else None
                        )
                        accepted_prefix = (
                            list(
                                challenge.get(
                                    "acknowledgedTransitionContentSha256s", []
                                )
                            )
                            if isinstance(challenge, dict)
                            else []
                        )
                        self._acknowledge_reconciled_menu_control_history_transitions(
                            list(dict.fromkeys(accepted_prefix + transition_hashes))
                        )
                        session = self._session_snapshot
                        if (
                            session is not None
                            and isinstance(challenge_replacement_lease, dict)
                            and challenge_replacement_lease.get("leaseId")
                            == session.lease_id
                        ):
                            self._menu_control_recovery_discovery_lease_id = (
                                session.lease_id
                            )
                            self._release_menu_control_recovery_barrier(
                                session.lease_id
                            )
                        self.incoming.put(
                            {
                                "kind": "menu_control_proof_recovery_acknowledged",
                                "requestId": request_id,
                                "recoveryId": recovery_id,
                                "recoveryKind": pending_menu_control_recovery_ack.get(
                                    "kind"
                                ),
                                "resultContentSha256": pending_menu_control_recovery_ack.get(
                                    "terminalResultContentSha256"
                                ),
                                "transitionContentSha256s": transition_hashes,
                            }
                        )
                        if isinstance(recovery_id, str):
                            self._menu_control_proof_reconciliations.pop(
                                recovery_id, None
                            )
                        pending_menu_control_recovery_ack = None
                        request_succeeded = True
                session = self._session_snapshot
                menu_control_history_delivery_allowed = (
                    session is not None
                    and self._menu_control_recovery_barrier_lease_id
                    != session.lease_id
                )
                if (
                    pending_menu_control_history_transition is None
                    and menu_control_history_delivery_allowed
                ):
                    try:
                        pending_menu_control_history_transition = (
                            self.menu_control_proof_history_transitions.get_nowait()
                        )
                    except Empty:
                        pass
                if (
                    pending_menu_control_history_transition is not None
                    and self._menu_control_history_transition_was_reconciled(
                        pending_menu_control_history_transition
                    )
                ):
                    pending_menu_control_history_transition = None
                    request_succeeded = True
                if (
                    pending_menu_control_history_transition is not None
                    and menu_control_history_delivery_allowed
                ):
                    request_id = pending_menu_control_history_transition.get("requestId")
                    try:
                        pending_menu_control_history_transition = (
                            self._refresh_menu_control_history_transition_lease(
                                pending_menu_control_history_transition
                            )
                        )
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/menu-control-proof-history-transition",
                            pending_menu_control_history_transition,
                        )
                        self._validate_exact_keys(
                            response,
                            {"result"},
                            "Menu-control history transition acknowledgement",
                        )
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError(
                                "Runtime did not acknowledge menu-control history transition"
                            )
                    except HTTPError as error:
                        error_payload = getattr(error, "runtime_payload", {})
                        runtime_code = self._runtime_error_code(error_payload)
                        if (
                            error.code == 409
                            and runtime_code
                            == "menu_control_proof_history_relock_conflict"
                            and pending_menu_control_history_transition.get(
                                "transition", {}
                            ).get("direction")
                            == "redo"
                        ):
                            self.incoming.put(
                                {
                                    "kind": "menu_control_history_relock_conflict",
                                    "requestId": request_id,
                                    "transitionContentSha256": (
                                        pending_menu_control_history_transition.get(
                                            "transitionContentSha256"
                                        )
                                    ),
                                    "transition": deepcopy(
                                        pending_menu_control_history_transition.get(
                                            "transition"
                                        )
                                    ),
                                    "runtimeCode": runtime_code,
                                    "runtimePayload": deepcopy(error_payload),
                                    "message": (
                                        error_payload.get("message")
                                        if isinstance(error_payload, dict)
                                        and isinstance(
                                            error_payload.get("message"), str
                                        )
                                        else "Runtime rejected stale native Redo relock evidence"
                                    ),
                                }
                            )
                            self._release_menu_control_history_transition(
                                pending_menu_control_history_transition
                            )
                            pending_menu_control_history_transition = None
                            request_succeeded = True
                            continue
                        transient_authority_codes = {
                            "lease_not_current",
                            "menu_control_proof_delivery_lease_not_current",
                            "menu_control_proof_history_transition_lease_not_current",
                        }
                        if (
                            not 400 <= error.code < 500
                            or (
                                error.code == 409
                                and runtime_code in transient_authority_codes
                            )
                        ):
                            raise
                        self.incoming.put(
                            {
                                "kind": "menu_control_history_transition_rejected",
                                "requestId": request_id,
                                "transitionContentSha256": (
                                    pending_menu_control_history_transition.get(
                                        "transitionContentSha256"
                                    )
                                ),
                                "runtimeCode": runtime_code,
                                "runtimePayload": deepcopy(error_payload),
                                "message": (
                                    error_payload.get("message")
                                    if isinstance(error_payload, dict)
                                    and isinstance(error_payload.get("message"), str)
                                    else "Runtime permanently rejected menu-control history "
                                    f"transition (HTTP {error.code})"
                                ),
                            }
                        )
                        self._release_menu_control_history_transition(
                            pending_menu_control_history_transition
                        )
                        pending_menu_control_history_transition = None
                        request_succeeded = True
                    else:
                        self.incoming.put(
                            {
                                "kind": "menu_control_history_transition_acknowledged",
                                "requestId": request_id,
                                "transitionContentSha256": (
                                    pending_menu_control_history_transition.get(
                                        "transitionContentSha256"
                                    )
                                ),
                            }
                        )
                        self._release_menu_control_history_transition(
                            pending_menu_control_history_transition
                        )
                        pending_menu_control_history_transition = None
                        request_succeeded = True
                if pending_shortcut_progress is None:
                    try:
                        pending_shortcut_progress = self.shortcut_proof_progress.get_nowait()
                    except Empty:
                        pass
                if pending_shortcut_recovery_ack is None:
                    try:
                        pending_shortcut_recovery_ack = self.shortcut_proof_recovery_acks.get_nowait()
                    except Empty:
                        pass
                if pending_shortcut_recovery_ack is not None:
                    request_id = pending_shortcut_recovery_ack.get("requestId")
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/shortcut-proof-recovery",
                            pending_shortcut_recovery_ack,
                        )
                        self._validate_exact_keys(
                            response, {"result"}, "Shortcut proof recovery ack"
                        )
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError(
                                "Runtime did not acknowledge shortcut proof recovery"
                            )
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        self.incoming.put({
                            "kind": "shortcut_proof_recovery_rejected",
                            "requestId": request_id,
                            "message": (
                                "Runtime permanently rejected shortcut proof recovery "
                                f"(HTTP {error.code})"
                            ),
                        })
                        pending_shortcut_recovery_ack = None
                        request_succeeded = True
                    else:
                        self.incoming.put({
                            "kind": "shortcut_proof_recovery_acknowledged",
                            "requestId": request_id,
                            "recoveryId": pending_shortcut_recovery_ack.get(
                                "recoveryId"
                            ),
                            "resultContentSha256s": (
                                [
                                    self._canonical_sha256(result)
                                    for result in pending_shortcut_recovery_ack.get(
                                        "results", []
                                    )
                                ]
                                if pending_shortcut_recovery_ack.get("kind")
                                == "native_history_transition_reconcile"
                                else []
                            ),
                        })
                        pending_shortcut_recovery_ack = None
                        request_succeeded = True
                if pending_shortcut_progress is not None:
                    request_id = pending_shortcut_progress.get("requestId")
                    if request_id in shortcut_reporting_blocked:
                        pending_shortcut_progress = None
                        request_succeeded = True
                        continue
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/shortcut-proof-progress",
                            pending_shortcut_progress,
                        )
                        self._validate_exact_keys(response, {"result"}, "Shortcut proof progress ack")
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError("Runtime did not acknowledge shortcut proof progress")
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        self.incoming.put({
                            "kind": "shortcut_proof_progress_rejected",
                            "requestId": request_id,
                            "message": f"Runtime permanently rejected shortcut proof progress (HTTP {error.code})",
                        })
                        pending_shortcut_progress = None
                        if isinstance(request_id, str):
                            shortcut_reporting_blocked.add(request_id)
                        request_succeeded = True
                    else:
                        pending_shortcut_progress = None
                        request_succeeded = True
                progress_backlog_pending = (
                    pending_shortcut_progress is not None
                    or not self.shortcut_proof_progress.empty()
                )
                if pending_shortcut_result is None and not progress_backlog_pending:
                    try:
                        pending_shortcut_result = self.shortcut_proof_results.get_nowait()
                    except Empty:
                        pass
                if pending_shortcut_result is not None and not progress_backlog_pending:
                    request_id = pending_shortcut_result.get("requestId")
                    if request_id in shortcut_reporting_blocked:
                        pending_shortcut_result = None
                        request_succeeded = True
                        continue
                    try:
                        response = self._request_json(
                            "POST",
                            "/api/v1/companion/shortcut-proof-result",
                            pending_shortcut_result,
                        )
                        self._validate_exact_keys(response, {"result"}, "Shortcut proof result ack")
                        if response["result"] not in {"accepted", "duplicate"}:
                            raise ValueError("Runtime did not acknowledge shortcut proof result")
                    except HTTPError as error:
                        if not 400 <= error.code < 500:
                            raise
                        self.incoming.put({
                            "kind": "shortcut_proof_result_rejected",
                            "requestId": request_id,
                            "message": f"Runtime permanently rejected shortcut proof result (HTTP {error.code})",
                        })
                        pending_shortcut_result = None
                        if isinstance(request_id, str):
                            shortcut_reporting_blocked.add(request_id)
                        request_succeeded = True
                    else:
                        self.incoming.put({
                            "kind": "shortcut_proof_result_acknowledged",
                            "requestId": request_id,
                            "resultContentSha256": self._canonical_sha256(
                                pending_shortcut_result
                            ),
                        })
                        pending_shortcut_result = None
                        request_succeeded = True
                now = time.monotonic()
                session = self._session_snapshot
                menu_control_recovery_barrier_active = (
                    session is not None
                    and self._menu_control_recovery_barrier_lease_id
                    == session.lease_id
                )
                menu_control_recovery_discovery_complete = (
                    session is not None
                    and self._menu_control_recovery_discovery_lease_id
                    == session.lease_id
                )
                menu_control_history_backlog = (
                    pending_menu_control_history_transition is not None
                    or not self.menu_control_proof_history_transitions.empty()
                )
                menu_control_recovery_ack_backlog = (
                    pending_menu_control_recovery_ack is not None
                    or not self.menu_control_proof_recovery_acks.empty()
                ) and (
                    not menu_control_recovery_barrier_active
                    or menu_control_recovery_discovery_complete
                )
                menu_control_recovery_backlog = (
                    menu_control_recovery_ack_backlog
                    or (
                        not menu_control_recovery_barrier_active
                        and menu_control_history_backlog
                    )
                )
                if (
                    not self._stop.is_set()
                    and session is not None
                    and now >= next_poll
                    and not menu_control_recovery_backlog
                ):
                    self._poll()
                    if active_replan_run_id is not None:
                        run = self._poll_replan_run(active_replan_run_id)
                        status = self._validate_replan_run_response(
                            run, active_replan_run_id
                        )
                        signature = json.dumps(
                            run, sort_keys=True, separators=(",", ":")
                        )
                        if signature != replan_run_signature:
                            replan_run_signature = signature
                            self.incoming.put(
                                {"kind": "replan_run_status", "run": run}
                            )
                        if status in TERMINAL_REPLAN_RUN_STATUSES:
                            active_replan_run_id = None
                            replan_run_signature = None
                    if active_dialogue_run_id is not None:
                        run = self._poll_dialogue_run(active_dialogue_run_id)
                        status = self._validate_dialogue_run_response(
                            run, active_dialogue_run_id
                        )
                        signature = json.dumps(
                            run, sort_keys=True, separators=(",", ":")
                        )
                        if signature != dialogue_run_signature:
                            dialogue_run_signature = signature
                            self.incoming.put(
                                {"kind": "dialogue_run_status", "run": run}
                            )
                        if status in TERMINAL_DIALOGUE_RUN_STATUSES:
                            active_dialogue_run_id = None
                            dialogue_run_signature = None
                    if active_initial_plan_run_id is not None:
                        run = self._poll_initial_plan_run(active_initial_plan_run_id)
                        status = self._validate_initial_plan_run_response(
                            run, active_initial_plan_run_id
                        )
                        signature = json.dumps(
                            run, sort_keys=True, separators=(",", ":")
                        )
                        if signature != initial_plan_run_signature:
                            initial_plan_run_signature = signature
                            self.incoming.put(
                                {"kind": "initial_plan_run_status", "run": run}
                            )
                        if status in TERMINAL_INITIAL_PLAN_RUN_STATUSES:
                            active_initial_plan_run_id = None
                            initial_plan_run_signature = None
                    request_succeeded = True
                    next_poll = now + self._poll_interval
                if request_succeeded and last_error:
                    self.incoming.put({"kind": "recovered"})
                    last_error = ""
            except (
                HTTPError,
                HTTPException,
                OSError,
                ValueError,
                json.JSONDecodeError,
            ) as error:
                self._clear_session()
                current_time = time.monotonic()
                next_session_attempt_at = current_time + session_retry_delay
                session_retry_delay = min(session_retry_delay * 2, 5.0)
                message = str(error)
                intentional_stop_abort = self._stop.is_set() and isinstance(
                    error, (HTTPException, OSError)
                )
                if not intentional_stop_abort and message != last_error:
                    self.incoming.put({"kind": "error", "message": message})
                    last_error = message
                next_poll = current_time + self._poll_interval
            if self._stop.is_set():
                time.sleep(0.01)
            else:
                self._stop.wait(0.05)
        self._clear_session()
