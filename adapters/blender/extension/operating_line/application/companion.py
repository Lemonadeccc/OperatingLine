"""Main-thread lifecycle and state reporting for the live companion."""

from __future__ import annotations

from datetime import datetime, timezone
from queue import Empty
import time
import uuid
from typing import Any

import bpy

from ..domain import load_task_tree_data
from ..infrastructure.blender_actions import action_registry
from ..infrastructure.companion_transport import CompanionTransport
from ..infrastructure.observations import evaluate_observations
from .session import DemoSession

PROTOCOL_VERSION = "1.0.0"
COMPANION_VERSION = "0.1.0"


class CompanionController:
    def __init__(self) -> None:
        self.instance_id = str(uuid.uuid4())
        self.status = "Offline"
        self.error = ""
        self._transport: CompanionTransport | None = None
        self._stopping_transports: list[CompanionTransport] = []
        self._timer_registered = False
        self._timer_callback = self.pump
        self._sequence = 0
        self.last_report: dict[str, Any] | None = None
        self.last_delivered_sequence = 0
        self.pending_plan: dict[str, Any] | None = None
        self.proposed_plan: dict[str, Any] | None = None
        self.proposal_session: DemoSession | None = None
        self._last_rejected_plan: tuple[Any, ...] | None = None
        self._last_rejected_proposal: tuple[Any, ...] | None = None

    @property
    def connected(self) -> bool:
        return self._transport is not None and self._transport.running

    @property
    def timer_registered(self) -> bool:
        return self._timer_registered

    @property
    def timer_callback(self):
        return self._timer_callback

    def register_timer(self) -> None:
        if self._timer_registered:
            return
        bpy.app.timers.register(self._timer_callback, first_interval=0.1, persistent=True)
        self._timer_registered = True

    def unregister_timer(self) -> None:
        self.disconnect(flush_timeout=0.0, wait_timeout=0.1)
        if self._timer_registered and bpy.app.timers.is_registered(self._timer_callback):
            bpy.app.timers.unregister(self._timer_callback)
        self._timer_registered = False

    def connect(self, base_url: str, token: str) -> None:
        if not getattr(bpy.app, "online_access", True):
            raise ValueError("Blender online access is disabled")
        from .. import get_session

        session = get_session()
        transport = CompanionTransport(
            base_url,
            token,
            self.instance_id,
            known_plan_id=session.plan_id,
            known_revision=session.revision,
        )
        self.disconnect()
        self._transport = transport
        self.error = ""
        self.status = "Connecting"
        transport.start()
        self.status = "Connected"
        self.report("connected")

    def disconnect(
        self,
        *,
        flush_timeout: float = 1.5,
        wait_timeout: float = 0.0,
    ) -> None:
        transport = self._transport
        self._transport = None
        if transport is not None:
            transport.stop(flush_timeout=flush_timeout)
            self._stopping_transports.append(transport)
        if flush_timeout <= 0:
            for stopping in self._stopping_transports:
                stopping.stop(flush_timeout=0.0)
        self._reap_stopping_transports(wait_timeout)
        self.pending_plan = None
        self.proposed_plan = None
        self.proposal_session = None
        self._last_rejected_plan = None
        self._last_rejected_proposal = None

    def _reap_stopping_transports(self, wait_timeout: float = 0.0) -> None:
        deadline = time.monotonic() + max(0.0, wait_timeout)
        still_stopping: list[CompanionTransport] = []
        for transport in self._stopping_transports:
            remaining = max(0.0, deadline - time.monotonic())
            if transport.wait_stopped(remaining):
                self.last_delivered_sequence = max(
                    self.last_delivered_sequence,
                    transport.last_delivered_sequence,
                )
            else:
                still_stopping.append(transport)
        self._stopping_transports = still_stopping
        if self._transport is None:
            self.status = "Disconnecting" if still_stopping else "Offline"

    @staticmethod
    def _validated_session(plan: dict[str, Any]) -> DemoSession:
        if not isinstance(plan, dict):
            raise ValueError("Plan must be a JSON object")
        if plan.get("protocolVersion") != PROTOCOL_VERSION:
            raise ValueError("Unsupported guide protocol version")
        plan_id = plan.get("id")
        revision = plan.get("revision")
        if not isinstance(plan_id, str) or not plan_id:
            raise ValueError("Plan id must be a non-empty string")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision <= 0:
            raise ValueError("Plan revision must be a positive integer")
        root = load_task_tree_data(plan)
        actions = action_registry(root)  # validates adapter/action allowlist and arguments
        return DemoSession(root, actions, plan_id=plan_id, revision=revision)

    def install_plan(self, plan: dict[str, Any]) -> bool:
        """Validate fully before replacing the active session."""
        from .. import get_session, replace_session

        replacement = self._validated_session(plan)
        plan_id = replacement.plan_id
        revision = replacement.revision
        assert plan_id is not None and revision is not None
        current = get_session()
        if (
            current.plan_id == plan_id
            and current.revision is not None
            and revision <= current.revision
        ):
            if self._transport is not None:
                self._transport.accept_plan(plan_id, current.revision)
            self.status = f"Plan {plan_id} r{current.revision}"
            self.error = ""
            return True
        if current.receipts:
            pending = self.pending_plan
            is_new_pending = (
                pending is None
                or plan_id != pending.get("id")
                or revision > pending.get("revision", 0)
            )
            if is_new_pending:
                self.pending_plan = plan
            accepted = self.pending_plan or plan
            if self._transport is not None:
                self._transport.accept_plan(accepted["id"], accepted["revision"])
            if is_new_pending:
                message = (
                    "Plan update is pending; use Back to roll the walkthrough "
                    "to its start first"
                )
                self.error = message
                self.status = "Plan update pending"
                self.report("error", error=message)
            return False
        replace_session(replacement)
        if (
            self.pending_plan is not None
            and self.pending_plan.get("id") == plan_id
            and self.pending_plan.get("revision") == revision
        ):
            self.pending_plan = None
        if self._transport is not None:
            self._transport.accept_plan(plan_id, revision)
        self.status = f"Plan {plan_id} r{revision}"
        self.error = ""
        self._last_rejected_plan = None
        self.report("plan_loaded")
        return True

    def stage_proposal(self, proposal: dict[str, Any]) -> bool:
        """Validate an AI-authored proposal without replacing or executing a session."""
        if not isinstance(proposal, dict):
            raise ValueError("Proposal must be a JSON object")
        expected_fields = {
            "protocolVersion",
            "proposalId",
            "targetAdapterId",
            "plan",
            "proposedAt",
        }
        if set(proposal) != expected_fields:
            raise ValueError("Proposal fields do not match the versioned protocol")
        if proposal.get("protocolVersion") != PROTOCOL_VERSION:
            raise ValueError("Unsupported proposal protocol version")
        proposal_id = proposal.get("proposalId")
        if not isinstance(proposal_id, str):
            raise ValueError("Proposal id must be a UUID")
        try:
            uuid.UUID(proposal_id)
        except ValueError as error:
            raise ValueError("Proposal id must be a UUID") from error
        if proposal.get("targetAdapterId") != "blender":
            raise ValueError("Proposal does not target the Blender adapter")
        proposed_at = proposal.get("proposedAt")
        if not isinstance(proposed_at, str):
            raise ValueError("Proposal timestamp must include a timezone")
        try:
            parsed_time = datetime.fromisoformat(proposed_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("Proposal timestamp must be an ISO date-time") from error
        if parsed_time.tzinfo is None:
            raise ValueError("Proposal timestamp must include a timezone")

        replacement = self._validated_session(proposal.get("plan"))
        if (
            self.proposed_plan is not None
            and self.proposed_plan.get("proposalId") == proposal_id
        ):
            return True
        self.proposed_plan = proposal
        self.proposal_session = replacement
        self._last_rejected_proposal = None
        self.error = ""
        self.status = (
            f"Plan proposal {replacement.plan_id} r{replacement.revision} awaiting review"
        )
        return True

    def accept_proposal(self) -> bool:
        """Install the staged proposal only when the active session owns no effects."""
        from .. import get_session

        proposal = self.proposed_plan
        if proposal is None or self.proposal_session is None:
            self.error = "No plan proposal is awaiting review"
            return False
        if get_session().receipts:
            message = (
                "Plan proposal is blocked; use Back to roll the active walkthrough "
                "to its start first"
            )
            self.error = message
            self.status = "Plan proposal blocked"
            self.report("error", error=message)
            return False

        proposal_id = proposal["proposalId"]
        if not self.install_plan(proposal["plan"]):
            return False
        transport = self._transport
        if transport is not None:
            transport.decide_proposal(proposal_id, "accepted")
        self.proposed_plan = None
        self.proposal_session = None
        self._last_rejected_proposal = None
        self.status = f"Plan {get_session().plan_id} r{get_session().revision} accepted"
        self.error = ""
        return True

    def reject_proposal(self) -> bool:
        """Reject the staged proposal without changing the active session or scene."""
        from .. import get_session

        proposal = self.proposed_plan
        if proposal is None:
            self.error = "No plan proposal is awaiting review"
            return False
        transport = self._transport
        if transport is not None:
            transport.decide_proposal(proposal["proposalId"], "rejected")
        self.proposed_plan = None
        self.proposal_session = None
        self._last_rejected_proposal = None
        session = get_session()
        self.status = (
            f"Plan {session.plan_id} r{session.revision}"
            if session.plan_id is not None and session.revision is not None
            else ("Connected" if self.connected else "Offline")
        )
        self.error = ""
        return True

    def pump(self) -> float | None:
        from .. import get_session

        self._reap_stopping_transports()
        if self.pending_plan is not None and not get_session().receipts:
            pending = self.pending_plan
            try:
                self.install_plan(pending)
            except (KeyError, TypeError, ValueError) as error:
                self.pending_plan = None
                self.error = str(error)
                self.status = "Plan rejected"
                self.report("error", error=self.error)
        transport = self._transport
        if transport is not None:
            while True:
                try:
                    message = transport.incoming.get_nowait()
                except Empty:
                    break
                if message.get("kind") == "plan":
                    plan = message.get("plan")
                    try:
                        self.install_plan(plan)
                    except (KeyError, TypeError, ValueError) as error:
                        plan_id = plan.get("id") if isinstance(plan, dict) else None
                        revision = plan.get("revision") if isinstance(plan, dict) else None
                        rejected_key = (
                            (plan_id, revision)
                            if isinstance(plan_id, str)
                            and bool(plan_id)
                            and isinstance(revision, int)
                            and not isinstance(revision, bool)
                            and revision > 0
                            else None
                        )
                        if rejected_key is not None:
                            transport.accept_plan(*rejected_key)
                        rejection_fingerprint = (
                            ("plan", *rejected_key)
                            if rejected_key is not None
                            else ("invalid", str(error))
                        )
                        if rejection_fingerprint != self._last_rejected_plan:
                            self._last_rejected_plan = rejection_fingerprint
                            self.error = str(error)
                            self.status = "Plan rejected"
                            self.report("error", error=self.error)
                elif message.get("kind") == "proposal":
                    proposal = message.get("proposal")
                    try:
                        self.stage_proposal(proposal)
                    except (KeyError, TypeError, ValueError) as error:
                        proposal_id = (
                            proposal.get("proposalId")
                            if isinstance(proposal, dict)
                            else None
                        )
                        valid_proposal_id = False
                        if isinstance(proposal_id, str):
                            try:
                                uuid.UUID(proposal_id)
                                valid_proposal_id = True
                            except ValueError:
                                pass
                        if valid_proposal_id:
                            transport.decide_proposal(proposal_id, "rejected")
                        rejection_fingerprint = (
                            proposal_id if valid_proposal_id else str(error),
                            str(error),
                        )
                        if rejection_fingerprint != self._last_rejected_proposal:
                            self._last_rejected_proposal = rejection_fingerprint
                            self.error = str(error)
                            self.status = "Plan proposal rejected"
                            self.report("error", error=self.error)
                elif message.get("kind") == "error":
                    self.error = str(message.get("message", "Runtime connection error"))
                    self.status = "Connection error"
                elif message.get("kind") == "recovered":
                    self.error = ""
                    session = get_session()
                    if self.proposal_session is not None:
                        self.status = (
                            f"Plan proposal {self.proposal_session.plan_id} "
                            f"r{self.proposal_session.revision} awaiting review"
                        )
                    else:
                        self.status = (
                            f"Plan {session.plan_id} r{session.revision}"
                            if session.plan_id is not None
                            and session.revision is not None
                            else "Connected"
                        )
        if not self._timer_registered:
            return None
        return 0.2 if self.connected else 1.0

    def report(
        self,
        transition: str,
        *,
        step: Any = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        from .. import get_session

        session = get_session()
        active = session.active_step
        completed = [item.id for item in session.steps[: session.active_index + 1]]
        if error is not None:
            phase = "error"
        elif session.started and session.active_index == len(session.steps) - 1:
            phase = "completed"
        elif session.started:
            phase = "running"
        elif session.plan_id is not None:
            phase = "ready"
        else:
            phase = "idle"
        observation_step = step or active
        observations = (
            evaluate_observations(
                observation_step.expected_observations,
                session.receipts,
            )
            if observation_step is not None
            else []
        )
        self._sequence += 1
        report = {
            "protocolVersion": PROTOCOL_VERSION,
            "reportId": str(uuid.uuid4()),
            "sequence": self._sequence,
            "adapterId": "blender",
            "instanceId": self.instance_id,
            "companionVersion": COMPANION_VERSION,
            "hostVersion": bpy.app.version_string,
            "plan": (
                {"id": session.plan_id, "revision": session.revision}
                if session.plan_id is not None and session.revision is not None
                else None
            ),
            "phase": phase,
            "activeStepId": active.id if active is not None else None,
            "completedStepIds": completed,
            "transition": transition,
            "stepId": step.id if step is not None else None,
            "observations": observations,
            "error": error,
            "occurredAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        if self._transport is not None:
            self._transport.send_report(report)
        self.last_report = report
        return report
