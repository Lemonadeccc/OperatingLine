"""Background HTTP transport for the Blender companion.

This module intentionally has no Blender imports.  Worker threads exchange only
plain JSON-compatible messages with the main-thread companion controller.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
import ipaddress
import json
import re
from http.client import HTTPConnection, HTTPException, HTTPResponse
from queue import Empty, Queue
import socket
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
        self.control: Queue[dict[str, Any]] = Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._flush_deadline = 0.0
        self._last_delivered_sequence = 0
        self._session_snapshot: CompanionSessionSnapshot | None = None
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
            or path == "/api/v1/companion/state"
            or path == "/api/v1/companion/proposal-decision"
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
        self._poll_revision_history()
        self._poll_revision_branches()

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
            or pending_decision is not None
            or pending_revision_request is not None
            or pending_goal_request is not None
            or pending_dialogue_run is not None
            or not self.outgoing.empty()
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
                    if isinstance(sequence, int):
                        self._last_delivered_sequence = max(
                            self._last_delivered_sequence, sequence
                        )
                    pending_report = None
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
