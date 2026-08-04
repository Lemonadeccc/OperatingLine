"""Background HTTP transport for the Blender companion.

This module intentionally has no Blender imports.  Worker threads exchange only
plain JSON-compatible messages with the main-thread companion controller.
"""

from __future__ import annotations

from datetime import datetime, timezone
import ipaddress
import json
from http.client import HTTPConnection, HTTPException, HTTPResponse
from queue import Empty, Queue
import socket
import threading
import time
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit, urlunsplit
import uuid

from ..domain import PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS

MAX_RESPONSE_BYTES = 4 * 1024 * 1024


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
        known_proposal_id: str | None = None,
        poll_interval: float = 1.0,
        timeout: float = 0.75,
    ) -> None:
        self.base_url = validate_companion_url(base_url)
        if not isinstance(token, str) or len(token) < 16:
            raise ValueError("Bearer token must contain at least 16 characters")
        self._token = token
        self._instance_id = instance_id
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
        self.control: Queue[dict[str, Any]] = Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._flush_deadline = 0.0
        self._last_delivered_sequence = 0
        if (known_plan_id is None) != (known_revision is None):
            raise ValueError("Known plan id and revision must be provided together")
        self._known_plan_id = known_plan_id
        self._known_revision = known_revision
        self._known_proposal_id = known_proposal_id
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

    def accept_plan(self, plan_id: str, revision: int) -> None:
        self.control.put(
            {"kind": "plan_accepted", "planId": plan_id, "revision": revision}
        )

    def submit_revision_request(self, request: dict[str, Any]) -> None:
        request_id = request.get("requestId")
        if not isinstance(request_id, str) or not request_id:
            raise ValueError("Revision request must contain a requestId")
        self.revision_requests.put(request)

    def decide_proposal(self, proposal_id: str, decision: str) -> None:
        if decision not in {"accepted", "rejected"}:
            raise ValueError("Proposal decision must be accepted or rejected")
        self.control.put({"kind": "proposal_seen", "proposalId": proposal_id})
        self.decisions.put(
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
            if not 200 <= response.status < 300:
                raise HTTPError(
                    f"{self.base_url}{path}",
                    response.status,
                    response.reason,
                    response.headers,
                    None,
                )
            body = self._read_response_body(
                response,
                abort_on_stop=abort_on_stop,
            )
        finally:
            deadline.cancel()
            connection.close()
            with self._connection_lock:
                if self._active_connection is connection:
                    self._active_connection = None
                    self._active_socket = None
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError("Runtime response exceeds 4 MiB limit")
        decoded = json.loads(body.decode("utf-8")) if body else {}
        if not isinstance(decoded, dict):
            raise ValueError("Runtime response must be a JSON object")
        return decoded

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
        query: dict[str, str] = {
            "adapterId": "blender",
            "instanceId": self._instance_id,
        }
        if self._known_plan_id is not None:
            query["knownPlanId"] = self._known_plan_id
        if self._known_revision is not None:
            query["knownRevision"] = str(self._known_revision)
        if self._known_proposal_id is not None:
            query["knownProposalId"] = self._known_proposal_id
        response = self._request_json(
            "GET",
            f"/api/v1/companion/guide?{urlencode(query)}",
            abort_on_stop=True,
        )
        if response.get("protocolVersion") not in SUPPORTED_PROTOCOL_VERSIONS:
            raise ValueError("Unsupported companion protocol version")
        plan = response.get("plan")
        if plan is not None:
            if not isinstance(plan, dict):
                raise ValueError("Runtime plan must be an object or null")
            self.incoming.put({"kind": "plan", "plan": plan})
        proposal = response.get("proposal")
        if proposal is not None:
            if not isinstance(proposal, dict):
                raise ValueError("Runtime proposal must be an object or null")
            proposal_id = proposal.get("proposalId")
            if not isinstance(proposal_id, str) or not proposal_id:
                raise ValueError("Runtime proposal must contain a proposalId")
            self._known_proposal_id = proposal_id
            self.incoming.put({"kind": "proposal", "proposal": proposal})

    def _run(self) -> None:
        next_poll = 0.0
        pending_report: dict[str, Any] | None = None
        pending_decision: dict[str, Any] | None = None
        pending_revision_request: dict[str, Any] | None = None
        last_error = ""
        while (
            not self._stop.is_set()
            or pending_report is not None
            or pending_decision is not None
            or pending_revision_request is not None
            or not self.outgoing.empty()
            or not self.decisions.empty()
            or not self.revision_requests.empty()
        ):
            if self._stop.is_set() and time.monotonic() >= self._flush_deadline:
                break
            try:
                request_succeeded = False
                while True:
                    try:
                        control = self.control.get_nowait()
                    except Empty:
                        break
                    if control.get("kind") == "plan_accepted":
                        self._known_plan_id = str(control["planId"])
                        self._known_revision = int(control["revision"])
                    elif control.get("kind") == "proposal_seen":
                        self._known_proposal_id = str(control["proposalId"])
                if pending_decision is None:
                    try:
                        pending_decision = self.decisions.get_nowait()
                    except Empty:
                        pass
                if pending_decision is not None:
                    response = self._request_json(
                        "POST",
                        "/api/v1/companion/proposal-decision",
                        pending_decision,
                    )
                    if response.get("result") not in {"accepted", "duplicate"}:
                        raise ValueError(
                            "Runtime rejected or did not acknowledge proposal decision"
                        )
                    request_succeeded = True
                    pending_decision = None
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
                    self.incoming.put(
                        {
                            "kind": "revision_request_acknowledged",
                            "requestId": request_id,
                        }
                    )
                    request_succeeded = True
                    pending_revision_request = None
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
                message = str(error)
                if message != last_error:
                    self.incoming.put({"kind": "error", "message": message})
                    last_error = message
                next_poll = time.monotonic() + self._poll_interval
            if self._stop.is_set():
                time.sleep(0.01)
            else:
                self._stop.wait(0.05)
