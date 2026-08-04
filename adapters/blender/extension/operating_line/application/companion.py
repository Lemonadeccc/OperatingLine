"""Main-thread lifecycle and state reporting for the live companion."""

from __future__ import annotations

from datetime import datetime, timezone
from queue import Empty
import time
import uuid
from typing import Any

import bpy

from ..domain import (
    BLENDER_ACTION_CATALOG_VERSION,
    CATALOG_VERSION_PATTERN,
    load_task_tree_data,
)
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
        self._revision_base_session: DemoSession | None = None
        self._revision_reference_scope: str | None = None
        self._revision_reference_ids: list[str] = []
        self.revision_request_status = ""
        self.last_revision_request_id: str | None = None
        self._pending_revision_request_ids: set[str] = set()
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
        self.disconnect(preserve_active_revision_draft=True)
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
        preserve_active_revision_draft: bool = False,
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
        preserve_revision_draft = (
            preserve_active_revision_draft
            and self._revision_reference_scope == "active"
            and self._revision_base_session is not None
        )
        if not preserve_revision_draft:
            self.clear_revision_draft()
        self._pending_revision_request_ids.clear()
        if not preserve_revision_draft:
            self.revision_request_status = ""
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
        return DemoSession(
            root,
            actions,
            plan_id=plan_id,
            revision=revision,
            source_plan=plan,
        )

    def _session_for_reference_scope(self, scope: str) -> DemoSession:
        if scope == "proposal":
            if self.proposal_session is None:
                raise ValueError("No proposed plan is available for reference")
            return self.proposal_session
        if scope == "active":
            from .. import get_session

            return get_session()
        raise ValueError("Revision reference scope must be active or proposal")

    @property
    def revision_base_session(self) -> DemoSession | None:
        return self._revision_base_session

    @property
    def revision_reference_scope(self) -> str | None:
        return self._revision_reference_scope

    def revision_reference_nodes(self) -> tuple[Any, ...]:
        base = self._revision_base_session
        if base is None:
            return ()
        return tuple(
            node
            for node_id in self._revision_reference_ids
            for node in (base.find_node(node_id),)
            if node is not None
        )

    def add_revision_reference(self, scope: str, node_id: str) -> tuple[Any, bool]:
        base = self._session_for_reference_scope(scope)
        node = base.find_node(node_id)
        if node is None:
            raise ValueError(f"Unknown task node: {node_id}")
        if base.source_plan_copy() is None:
            raise ValueError("The selected plan has no immutable source payload")
        base_changed = self._revision_base_session is not None and self._revision_base_session is not base
        if base_changed:
            self.clear_revision_draft()
            self.revision_request_status = "Revision draft moved to a different base plan"
        if self._revision_base_session is None:
            self._revision_base_session = base
            self._revision_reference_scope = scope
        if node_id not in self._revision_reference_ids:
            if len(self._revision_reference_ids) >= 8:
                raise ValueError("A revision request can reference at most 8 nodes")
            self._revision_reference_ids.append(node_id)
        return node, base_changed

    def clear_revision_draft(self) -> None:
        self._revision_base_session = None
        self._revision_reference_scope = None
        self._revision_reference_ids.clear()
        window_manager = getattr(bpy.context, "window_manager", None)
        if window_manager is not None and hasattr(
            window_manager,
            "operating_line_revision_message",
        ):
            window_manager.operating_line_revision_message = ""

    def submit_revision_request(self, message: str) -> dict[str, Any]:
        transport = self._transport
        if transport is None or not transport.running:
            raise ValueError("Connect to the OperatingLine runtime before sending a request")
        base = self._revision_base_session
        references = self.revision_reference_nodes()
        if base is None or not references:
            raise ValueError("Select at least one task-node reference")
        normalized_message = message.strip() if isinstance(message, str) else ""
        if not normalized_message:
            raise ValueError("Revision request message must not be empty")
        if len(normalized_message) > 4000:
            raise ValueError("Revision request message must not exceed 4000 characters")
        source_plan = base.source_plan_copy()
        if source_plan is None:
            raise ValueError("The selected plan has no immutable source payload")
        request_id = str(uuid.uuid4())
        request = {
            "protocolVersion": PROTOCOL_VERSION,
            "requestId": request_id,
            "adapterId": "blender",
            "catalogVersion": BLENDER_ACTION_CATALOG_VERSION,
            "instanceId": self.instance_id,
            "basePlan": source_plan,
            "references": [
                {"nodeId": node.id, "nodeNumber": node.number} for node in references
            ],
            "message": normalized_message,
            "occurredAt": datetime.now(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
        }
        transport.submit_revision_request(request)
        self._pending_revision_request_ids.add(request_id)
        self.last_revision_request_id = request_id
        self.revision_request_status = (
            f"Request {request_id[:8]} queued; scene unchanged"
        )
        self.clear_revision_draft()
        return request

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
        if self._revision_base_session is current:
            self.clear_revision_draft()
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
        required_fields = {
            "protocolVersion",
            "proposalId",
            "targetAdapterId",
            "plan",
            "proposedAt",
        }
        optional_fields = {
            "revisionRequestId",
            "catalogVersion",
            "targetInstanceId",
        }
        if not required_fields.issubset(proposal) or set(proposal) - (
            required_fields | optional_fields
        ):
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
        target_instance_id = proposal.get("targetInstanceId")
        if target_instance_id is not None:
            if not isinstance(target_instance_id, str):
                raise ValueError("Proposal target instance id must be a UUID")
            try:
                uuid.UUID(target_instance_id)
            except ValueError as error:
                raise ValueError("Proposal target instance id must be a UUID") from error
            if target_instance_id != self.instance_id:
                raise ValueError("Proposal targets a different Blender instance")
        revision_request_id = proposal.get("revisionRequestId")
        if revision_request_id is not None:
            if not isinstance(revision_request_id, str):
                raise ValueError("Proposal revision request id must be a UUID")
            try:
                uuid.UUID(revision_request_id)
            except ValueError as error:
                raise ValueError("Proposal revision request id must be a UUID") from error
        catalog_version = proposal.get("catalogVersion")
        if catalog_version is not None and (
            not isinstance(catalog_version, str)
            or CATALOG_VERSION_PATTERN.fullmatch(catalog_version) is None
        ):
            raise ValueError("Proposal catalog version must use x.y.z")
        if (
            catalog_version is not None
            and catalog_version != BLENDER_ACTION_CATALOG_VERSION
        ):
            raise ValueError(
                f"Unsupported proposal catalog version: {catalog_version}"
            )
        if revision_request_id is not None and (
            target_instance_id is None or catalog_version is None
        ):
            raise ValueError(
                "A request-linked proposal must declare catalog and target instance"
            )
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
        previous_proposal_session = self.proposal_session
        if self._revision_base_session is previous_proposal_session:
            self.clear_revision_draft()
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
        accepted_session = self.proposal_session
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
        if self._revision_base_session is accepted_session:
            self._revision_base_session = get_session()
            self._revision_reference_scope = "active"
        else:
            self.clear_revision_draft()
        return True

    def reject_proposal(self) -> bool:
        """Reject the staged proposal without changing the active session or scene."""
        from .. import get_session

        proposal = self.proposed_plan
        if proposal is None:
            self.error = "No plan proposal is awaiting review"
            return False
        rejected_session = self.proposal_session
        transport = self._transport
        if transport is not None:
            transport.decide_proposal(proposal["proposalId"], "rejected")
        self.proposed_plan = None
        self.proposal_session = None
        if self._revision_base_session is rejected_session:
            self.clear_revision_draft()
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
                elif message.get("kind") == "revision_request_acknowledged":
                    request_id = message.get("requestId")
                    if isinstance(request_id, str):
                        self._pending_revision_request_ids.discard(request_id)
                        self.last_revision_request_id = request_id
                        self.revision_request_status = (
                            f"Request {request_id[:8]} stored for MCP planner"
                        )
                elif message.get("kind") == "error":
                    self.error = str(message.get("message", "Runtime connection error"))
                    self.status = "Connection error"
                    if self._pending_revision_request_ids:
                        self.revision_request_status = (
                            "Request delivery will retry after reconnect"
                        )
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
