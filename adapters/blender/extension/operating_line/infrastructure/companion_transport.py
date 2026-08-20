"""Background HTTP transport for the Blender companion.

This module intentionally has no Blender imports.  Worker threads exchange only
plain JSON-compatible messages with the main-thread companion controller.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
import ipaddress
import hashlib
import json
import re
from http.client import HTTPConnection, HTTPException, HTTPResponse
from queue import Empty, Queue
import socket
import struct
import threading
import time
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit, urlunsplit
import uuid

from ..domain import (
    BLENDER_ACTION_CATALOG_VERSION,
    PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    is_action_level_mcp_primitive,
)

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
COMPANION_SESSION_CONTRACT_VERSION = "1.0.0"
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


@dataclass(frozen=True)
class CompanionSessionSnapshot:
    """Immutable worker-owned view of one negotiated companion lease."""

    lease_id: str
    negotiated_guide_protocol_version: str
    heartbeat_interval_seconds: float
    expires_at: str
    next_heartbeat_at: float
    heartbeat_sequence: int


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
        self.shortcut_proof_progress: Queue[dict[str, Any]] = Queue()
        self.shortcut_proof_results: Queue[dict[str, Any]] = Queue()
        self.shortcut_proof_recovery_acks: Queue[dict[str, Any]] = Queue()
        self.control: Queue[dict[str, Any]] = Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._flush_deadline = 0.0
        self._last_delivered_sequence = 0
        self._last_delivered_report_identity: tuple[str, int] | None = None
        self._session_snapshot: CompanionSessionSnapshot | None = None
        self._seen_replay_current_state_verification_ids: set[str] = set()
        self._seen_action_request_ids: set[str] = set()
        self._seen_shortcut_proof_request_ids: set[str] = set()
        self._seen_shortcut_proof_recovery_ids: set[str] = set()
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
        generation_request_id = request.get("generationRequestId")
        self._validated_optional_uuid(
            generation_request_id,
            "Replan generation request id",
        )
        self.replan_runs.put(request)

    def refresh_dialogue_providers(self) -> None:
        """Queue streamed-dialogue provider discovery on the worker."""
        self.control.put({"kind": "refresh_dialogue_providers"})

    def start_dialogue_run(self, request: dict[str, Any]) -> None:
        dialogue_request_id = request.get("dialogueRequestId")
        self._validated_optional_uuid(dialogue_request_id, "Dialogue request id")
        self.dialogue_runs.put(request)

    def refresh_initial_plan_providers(self) -> None:
        """Queue an explicit initial-planner provider discovery request."""
        self.control.put({"kind": "refresh_initial_plan_providers"})

    def start_initial_plan_run(self, request: dict[str, Any]) -> None:
        generation_request_id = request.get("generationRequestId")
        self._validated_optional_uuid(
            generation_request_id,
            "Initial-plan generation request id",
        )
        self.initial_plan_runs.put(request)

    def decide_proposal(self, proposal_id: str, decision: str) -> None:
        self.submit_proposal_decision(
            {
                "protocolVersion": PROTOCOL_VERSION,
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
            or path == "/api/v1/companion/state"
            or path == "/api/v1/companion/proposal-decision"
            or path == "/api/v1/companion/action-result"
            or path.startswith("/api/v1/companion/shortcut-proof?")
            or path == "/api/v1/companion/shortcut-proof-progress"
            or path == "/api/v1/companion/shortcut-proof-result"
            or path == "/api/v1/companion/shortcut-proof-recovery"
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
            },
            "Companion session response",
        )
        if response["contractVersion"] != COMPANION_SESSION_CONTRACT_VERSION:
            raise ValueError("Unsupported companion session contract version")
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
            negotiated_guide_protocol_version=negotiated_version,
            heartbeat_interval_seconds=heartbeat_interval_seconds,
            expires_at=expires_at,
            next_heartbeat_at=time.monotonic() + heartbeat_interval_seconds,
            heartbeat_sequence=0,
        )
        self.incoming.put(
            {
                "kind": "session_established",
                "leaseId": lease_id,
                "negotiatedGuideProtocolVersion": negotiated_version,
                "expiresAt": expires_at,
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
                "sequence": sequence,
            },
            abort_on_stop=True,
        )
        self._validate_exact_keys(
            response,
            {"contractVersion", "leaseId", "sequence", "expiresAt"},
            "Companion heartbeat response",
        )
        if response["contractVersion"] != COMPANION_SESSION_CONTRACT_VERSION:
            raise ValueError("Unsupported companion heartbeat contract version")
        if response["leaseId"] != session.lease_id:
            raise ValueError("Runtime acknowledged the wrong companion lease")
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

    def _clear_session(self) -> None:
        self._session_snapshot = None

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
        if session.negotiated_guide_protocol_version == "1.5.0":
            self._poll_action_request()
            self._poll_shortcut_proof_request()

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
        allowed = required | {"observationPolicy"}
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
        if action["adapterId"] != "blender" or not is_action_level_mcp_primitive(
            action["name"]
        ):
            raise ValueError("Action execution is restricted to approved primitives")
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

    def _validate_shortcut_proof_binding(self, binding: Any) -> dict[str, Any]:
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

    def _validate_shortcut_proof_identity(self, payload: Any, label: str, *, terminal: bool = False) -> dict[str, Any]:
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
        if (
            not isinstance(heads, list)
            or len(heads) > len(self._shortcut_operation_ids())
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
        if validated["status"] != "in_progress" or not isinstance(completed, list) or not 1 <= len(completed) <= 4 or completed != validated["operationIds"][:len(completed)]:
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

    @staticmethod
    def _shortcut_operation_ids() -> list[str]:
        return [
            "shortcut.add_subdivision_surface_level_one",
            "shortcut.open_adjust_last_operation",
            "shortcut.set_viewport_level",
            "shortcut.close_adjust_last_operation",
        ]

    def _validate_shortcut_checkpoint(self, checkpoint: Any, *, failure: bool) -> dict[str, Any]:
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

    def _validate_shortcut_proof_result(self, result: Any) -> dict[str, Any]:
        validated = self._validate_shortcut_proof_identity(result, "Shortcut proof result", terminal=True)
        statuses = {"succeeded", "failed_checkpointed", "failed_restored", "rejected", "restored", "reapplied_locked"}
        if validated["status"] not in statuses or validated["managedActionResult"] != "not_executed" or validated["managedIdentityVerified"] is not False:
            raise ValueError("Shortcut proof result status or managed claims are invalid")
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
            self._validate_exact_keys(attestation, {"formatVersion", "attestationId", "deliveryId", "binding", "bindingContentSha256", "managedActionResult", "managedIdentityVerified", "executor", "operationReceipts", "strongObservation", "nativeUndoCheckpoint", "attestedAt", "integrity"}, "Shortcut proof attestation")
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
            if (
                checkpoint["proofId"] != validated["proofId"]
                or checkpoint["replayId"] != validated["replayId"]
                or checkpoint["targetId"] != accepted["targetId"]
                or checkpoint["finalState"]["viewportLevel"] != accepted["viewportLevel"]
                or checkpoint["receiptChainRootSha256"] != receipts[0]["contentSha256"]
                or checkpoint["receiptChainHeadSha256"] != receipts[-1]["contentSha256"]
                or checkpoint["strongObservationContentSha256"] != strong["contentSha256"]
                or checkpoint["finalSceneFingerprintSha256"]
                != strong["sceneFingerprintSha256"]
            ):
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
            if response.get("protocolVersion") != PROTOCOL_VERSION:
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
        pending_shortcut_progress: dict[str, Any] | None = None
        pending_shortcut_result: dict[str, Any] | None = None
        pending_shortcut_recovery_ack: dict[str, Any] | None = None
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
            or pending_shortcut_progress is not None
            or pending_shortcut_result is not None
            or pending_shortcut_recovery_ack is not None
            or pending_decision is not None
            or pending_revision_request is not None
            or pending_goal_request is not None
            or pending_dialogue_run is not None
            or not self.outgoing.empty()
            or not self.action_results.empty()
            or not self.shortcut_proof_progress.empty()
            or not self.shortcut_proof_results.empty()
            or not self.shortcut_proof_recovery_acks.empty()
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
                if not self._stop.is_set() and now >= next_poll:
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
                if message != last_error:
                    self.incoming.put({"kind": "error", "message": message})
                    last_error = message
                next_poll = current_time + self._poll_interval
            if self._stop.is_set():
                time.sleep(0.01)
            else:
                self._stop.wait(0.05)
        self._clear_session()
