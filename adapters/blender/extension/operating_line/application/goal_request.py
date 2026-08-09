"""State for one initial natural-language Goal-to-Guidance request."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
import uuid

from ..domain import BLENDER_ACTION_CATALOG_VERSION, PROTOCOL_VERSION


def build_goal_request(instance_id: str, goal: str) -> dict[str, Any]:
    """Build one stable, strict wire payload for initial planning."""
    try:
        uuid.UUID(instance_id)
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError("Companion instance id must be a UUID") from error
    normalized_goal = goal.strip() if isinstance(goal, str) else ""
    if not normalized_goal:
        raise ValueError("Goal must not be empty")
    if len(normalized_goal) > 10_000:
        raise ValueError("Goal must not exceed 10000 characters")
    request_id = str(uuid.uuid4())
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request_id,
        "adapterId": "blender",
        "catalogVersion": BLENDER_ACTION_CATALOG_VERSION,
        "instanceId": instance_id,
        "goal": normalized_goal,
        "planId": f"goal-{request_id}",
        "occurredAt": datetime.now(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
    }


class GoalRequestState:
    """Retain an immutable request while the transport delivers and retries it."""

    def __init__(self) -> None:
        self.phase = "idle"
        self.message = "Describe the result you want guidance for"
        self._payload: dict[str, Any] | None = None
        self.acknowledged_request_id: str | None = None

    @property
    def active(self) -> bool:
        return self._payload is not None

    @property
    def request_id(self) -> str | None:
        return None if self._payload is None else str(self._payload["requestId"])

    @property
    def short_request_id(self) -> str | None:
        request_id = self.request_id
        return None if request_id is None else request_id[:8]

    @property
    def payload(self) -> dict[str, Any] | None:
        return None if self._payload is None else deepcopy(self._payload)

    @property
    def goal_summary(self) -> str:
        if self._payload is None:
            return ""
        goal = str(self._payload["goal"])
        return goal if len(goal) <= 160 else f"{goal[:157]}..."

    def submit(self, payload: dict[str, Any]) -> None:
        if self.active:
            raise ValueError(
                "A goal request is already active; wait for and review its proposal"
            )
        self._payload = deepcopy(payload)
        self.acknowledged_request_id = None
        self.phase = "local"
        self.message = f"Request {self.short_request_id} queued locally"

    def delivering(self, request_id: object) -> None:
        if not self.active or request_id != self.request_id:
            return
        self.phase = "delivering"
        self.message = f"Delivering request {self.short_request_id}"

    def acknowledged(self, request_id: object) -> None:
        if request_id != self.request_id:
            return
        self.phase = "awaiting_planner"
        self.acknowledged_request_id = self.request_id
        self.message = f"Request {self.short_request_id} accepted; awaiting planner"

    def proposal_received(self) -> None:
        if not self.active:
            return
        self.phase = "proposal_received"
        self.message = f"Proposal received for request {self.short_request_id}"

    def delivery_error(self, message: object) -> None:
        if not self.active or self.phase not in {"local", "delivering", "error"}:
            return
        self.phase = "error"
        detail = str(message).strip() or "Runtime connection error"
        self.message = f"Request {self.short_request_id} retrying: {detail}"

    def delivery_rejected(self, request_id: object, message: object) -> bool:
        """Record a permanent response only for the exact active request."""
        if request_id != self.request_id:
            return False
        detail = str(message).strip() or "Runtime permanently rejected this goal"
        self.phase = "error"
        self.message = (
            f"Request {self.short_request_id} was not delivered: {detail}. "
            "Disconnect and reconnect after correcting the runtime conflict, "
            "or reload the extension to start a different goal."
        )
        return True

    def clear(self) -> None:
        self._payload = None
        self.acknowledged_request_id = None
        self.phase = "idle"
        self.message = "Describe the result you want guidance for"
