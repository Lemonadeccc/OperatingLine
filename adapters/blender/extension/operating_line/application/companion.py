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
    PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    load_task_tree_data,
)
from ..infrastructure.blender_actions import action_registry
from ..infrastructure.companion_transport import CompanionTransport
from ..infrastructure.observations import evaluate_observations
from .session import DemoSession
from .goal_request import GoalRequestState, build_goal_request
from .provider_handoff import ReplanRunState
from .revision_review import (
    RevisionLineage,
    lineage_from_proposal,
    new_revision_thread,
    validate_plan_diff,
    validate_revision_thread,
    validate_revision_thread_history,
)

COMPANION_VERSION = "0.1.0"
MAX_DEFERRED_PROPOSALS = 8


class ProposalQueueFullError(ValueError):
    """A bounded local defer queue filled without authorizing a decision."""


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
        self.pending_plan_content_sha256: str | None = None
        self.proposed_plan: dict[str, Any] | None = None
        self.proposal_session: DemoSession | None = None
        self._proposal_candidates: dict[
            tuple[str | None, str], tuple[dict[str, Any], DemoSession]
        ] = {}
        self._active_revision_lineage: RevisionLineage | None = None
        self.revision_thread_history: dict[str, Any] | None = None
        self.revision_history_error = ""
        self._revision_history_turns: dict[int, dict[str, Any]] = {}
        self._revision_history_has_more = False
        self._revision_history_next_before_turn: int | None = None
        self._revision_base_session: DemoSession | None = None
        self._revision_reference_scope: str | None = None
        self._revision_reference_ids: list[str] = []
        self.revision_request_status = ""
        self.last_revision_request_id: str | None = None
        self.provider_handoff = ReplanRunState()
        self.goal_request = GoalRequestState()
        self._pending_revision_request_ids: set[str] = set()
        self._last_rejected_plan: tuple[Any, ...] | None = None
        self._last_rejected_proposal: tuple[Any, ...] | None = None
        self._delivered_proposal_plan_content_sha256: str | None = None
        self._pending_proposal_decisions: dict[str, dict[str, Any]] = {}

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
        self.disconnect(
            flush_timeout=0.0,
            wait_timeout=0.1,
            preserve_active_revision_draft=False,
            preserve_proposal_review=False,
        )
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
            known_plan_content_sha256=session.plan_content_sha256,
            known_proposal_id=(
                self.proposed_plan.get("proposalId")
                if self.proposed_plan is not None
                else None
            ),
            known_revision_thread_id=(
                self._active_revision_lineage.thread_id
                if self._active_revision_lineage is not None
                else None
            ),
        )
        self.disconnect(
            preserve_active_revision_draft=True,
            preserve_proposal_review=True,
        )
        self._transport = transport
        self.error = ""
        self.status = "Connecting"
        transport.start()
        retained_goal = self.goal_request.payload
        if retained_goal is not None and self.goal_request.phase in {
            "local",
            "delivering",
            "error",
        }:
            transport.submit_goal_request(retained_goal)
        for decision in self._pending_proposal_decisions.values():
            transport.submit_proposal_decision(decision)
        self.status = "Connected"
        self.report("connected")

    def disconnect(
        self,
        *,
        flush_timeout: float = 1.5,
        wait_timeout: float = 0.0,
        preserve_active_revision_draft: bool = True,
        preserve_proposal_review: bool = True,
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
        self.pending_plan_content_sha256 = None
        if not preserve_proposal_review:
            self.proposed_plan = None
            self.proposal_session = None
            self._proposal_candidates.clear()
        if self._active_revision_lineage is None:
            self._clear_revision_history()
        self.revision_history_error = ""
        preserve_revision_draft = (
            preserve_active_revision_draft
            and self._revision_reference_scope == "active"
            and self._revision_base_session is not None
        )
        if not preserve_revision_draft:
            self.clear_revision_draft()
        self._pending_revision_request_ids.clear()
        self.provider_handoff.clear()
        if not preserve_revision_draft:
            self.revision_request_status = ""
        self._last_rejected_plan = None
        self._last_rejected_proposal = None
        if (
            not preserve_proposal_review
            and self.goal_request.phase == "proposal_received"
        ):
            self.goal_request.clear()

    def _queue_proposal_decision(
        self, proposal_id: str, decision: str
    ) -> dict[str, Any]:
        payload = {
            "protocolVersion": PROTOCOL_VERSION,
            "decisionId": str(uuid.uuid4()),
            "proposalId": proposal_id,
            "adapterId": "blender",
            "instanceId": self.instance_id,
            "decision": decision,
            "occurredAt": datetime.now(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
        }
        self._pending_proposal_decisions[payload["decisionId"]] = payload
        transport = self._transport
        if transport is not None:
            submit = getattr(transport, "submit_proposal_decision", None)
            if submit is not None:
                submit(payload)
            else:
                transport.decide_proposal(proposal_id, decision)
                self._pending_proposal_decisions.pop(payload["decisionId"], None)
        return payload

    @property
    def goal_entry_blocked(self) -> bool:
        """Whether existing revision/proposal work owns the review workspace."""
        return (
            self.proposed_plan is not None
            or self._revision_base_session is not None
            or bool(self._pending_revision_request_ids)
            or self.provider_handoff.pending_revision_request_id is not None
            or self.provider_handoff.acknowledged_revision_request_id is not None
        )

    def submit_goal_request(self, goal: str) -> dict[str, Any]:
        """Queue one immutable initial goal without planning on Blender's main thread."""
        transport = self._transport
        if transport is None or not transport.running:
            raise ValueError("Connect to the OperatingLine runtime before sending a goal")
        if self.goal_entry_blocked:
            raise ValueError("Finish the current revision or proposal review first")
        request = build_goal_request(self.instance_id, goal)
        self.goal_request.submit(request)
        transport.submit_goal_request(request)
        return request

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
    def _validated_session(
        plan: dict[str, Any],
        plan_content_sha256: str | None = None,
    ) -> DemoSession:
        if not isinstance(plan, dict):
            raise ValueError("Plan must be a JSON object")
        if plan.get("protocolVersion") not in SUPPORTED_PROTOCOL_VERSIONS:
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
            plan_content_sha256=plan_content_sha256,
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

    @property
    def revision_draft_lineage(self) -> RevisionLineage | None:
        base = self._revision_base_session
        scope = self._revision_reference_scope
        if base is None or scope is None:
            return None
        if scope == "proposal":
            if self.proposal_session is not base or self.proposed_plan is None:
                raise ValueError("The referenced proposal is no longer available")
            return lineage_from_proposal(self.proposed_plan)
        if scope == "active":
            from .. import get_session

            if get_session() is not base:
                raise ValueError("The referenced active plan is no longer installed")
            return self._active_revision_lineage
        raise ValueError("Revision reference scope must be active or proposal")

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

    def has_revision_reference(self, scope: str, node_id: str) -> bool:
        """Return whether the current draft references this node on this base."""
        if self._revision_reference_scope != scope:
            return False
        return node_id in self._revision_reference_ids

    def add_revision_reference(self, scope: str, node_id: str) -> Any:
        base = self._session_for_reference_scope(scope)
        node = base.find_node(node_id)
        if node is None:
            raise ValueError(f"Unknown task node: {node_id}")
        if base.source_plan_copy() is None:
            raise ValueError("The selected plan has no immutable source payload")
        if (
            self._revision_base_session is not None
            and self._revision_base_session is not base
        ):
            draft_scope = self._revision_reference_scope or "unknown"
            draft_base = self._revision_base_session
            raise ValueError(
                f"Draft base is {draft_scope} {draft_base.plan_id} "
                f"r{draft_base.revision}; cannot reference {scope} {base.plan_id} "
                f"r{base.revision}. Clear the draft before switching bases"
            )
        if self._revision_base_session is None:
            self._revision_base_session = base
            self._revision_reference_scope = scope
        if node_id not in self._revision_reference_ids:
            if len(self._revision_reference_ids) >= 8:
                raise ValueError("A revision request can reference at most 8 nodes")
            self._revision_reference_ids.append(node_id)
        return node

    def remove_revision_reference(self, node_id: str) -> bool:
        """Remove one reference while preserving the remaining draft and message."""
        if node_id not in self._revision_reference_ids:
            return False
        self._revision_reference_ids.remove(node_id)
        if not self._revision_reference_ids:
            self._revision_base_session = None
            self._revision_reference_scope = None
        return True

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

    def _clear_revision_history(self) -> None:
        self.revision_thread_history = None
        self._revision_history_turns.clear()
        self._revision_history_has_more = False
        self._revision_history_next_before_turn = None

    def _store_revision_history_page(self, history: dict[str, Any]) -> None:
        same_thread = (
            self.revision_thread_history is not None
            and self.revision_thread_history.get("threadId") == history["threadId"]
        )
        if not same_thread:
            self._clear_revision_history()
        had_turns = bool(self._revision_history_turns)
        for record in history["turns"]:
            self._revision_history_turns[record["turn"]] = record
        page = history["page"]
        if page["beforeTurn"] is not None or not had_turns:
            self._revision_history_has_more = page["hasMore"]
            self._revision_history_next_before_turn = page["nextBeforeTurn"]
        self.revision_thread_history = {
            **history,
            "turns": [
                self._revision_history_turns[turn]
                for turn in sorted(self._revision_history_turns)
            ],
            "page": {
                "beforeTurn": None,
                "nextBeforeTurn": self._revision_history_next_before_turn,
                "hasMore": self._revision_history_has_more,
            },
        }

    def load_older_revision_history(self) -> bool:
        transport = self._transport
        cursor = self._revision_history_next_before_turn
        if transport is None or not transport.running:
            self.revision_history_error = "Connect the runtime to load older turns"
            return False
        if cursor is None or not self._revision_history_has_more:
            self.revision_history_error = "No older revision turns are available"
            return False
        transport.load_revision_history_before(cursor)
        self.revision_history_error = f"Loading turns before {cursor}"
        return True

    @property
    def provider_descriptors(self) -> tuple[dict[str, Any], ...]:
        return self.provider_handoff.providers

    @property
    def selected_provider_id(self) -> str | None:
        return self.provider_handoff.selected_provider_id

    def refresh_replan_providers(self) -> None:
        self.provider_handoff.ensure_provider_refresh_allowed()
        transport = self._transport
        if transport is None or not transport.running:
            raise ValueError("Connect the runtime before refreshing providers")
        self.provider_handoff.loading_providers = True
        self.provider_handoff.message = "Refreshing replan providers"
        transport.refresh_replan_providers()

    def select_replan_provider(self, provider_id: str) -> dict[str, Any]:
        return self.provider_handoff.select(provider_id)

    def _invalidate_handoff_for_plan_install(self) -> None:
        if self.provider_handoff.invalidate_for_plan_install():
            self.last_revision_request_id = None

    def _acknowledge_revision_request(self, request_id: str) -> None:
        self._pending_revision_request_ids.discard(request_id)
        current_request = self.last_revision_request_id == request_id
        pending_handoff_id = self.provider_handoff.pending_revision_request_id
        acknowledged_handoff_id = (
            self.provider_handoff.acknowledged_revision_request_id
        )
        if pending_handoff_id == request_id or acknowledged_handoff_id == request_id:
            self.provider_handoff.revision_acknowledged(request_id)
        if current_request:
            self.revision_request_status = (
                f"Request {request_id[:8]} stored in runtime for MCP planner"
            )

    def begin_replan_run(self) -> dict[str, Any]:
        """Queue one authorized provider run without changing plan or scene state."""
        transport = self._transport
        if transport is None or not transport.running:
            raise ValueError("Connect the runtime before running a provider")
        request = self.provider_handoff.begin(target_instance_id=self.instance_id)
        transport.start_replan_run(request)
        return request

    def submit_revision_request(self, message: str) -> dict[str, Any]:
        if self.goal_request.active:
            raise ValueError("Finish the active goal request before sending a revision")
        self.provider_handoff.ensure_revision_submission_allowed()
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
        revision_thread = new_revision_thread(
            request_id,
            self.revision_draft_lineage,
        )
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
            "revisionThread": revision_thread,
            "occurredAt": datetime.now(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
        }
        transport.submit_revision_request(request)
        self._pending_revision_request_ids.add(request_id)
        self.provider_handoff.revision_submitted(request_id)
        self.last_revision_request_id = request_id
        self.revision_request_status = (
            f"Request {request_id[:8]} queued locally; scene unchanged"
        )
        self.clear_revision_draft()
        return request

    def install_plan(
        self,
        plan: dict[str, Any],
        *,
        plan_content_sha256: str | None = None,
        preserve_provider_handoff: bool = False,
    ) -> bool:
        """Validate fully before replacing the active session."""
        from .. import get_session, replace_session

        replacement = self._validated_session(plan, plan_content_sha256)
        plan_content_sha256 = replacement.plan_content_sha256
        plan_id = replacement.plan_id
        revision = replacement.revision
        assert plan_id is not None and revision is not None
        current = get_session()
        if (
            current.plan_id == plan_id
            and current.revision == revision
            and current.plan_content_sha256 != plan_content_sha256
        ):
            raise ValueError(
                "Plan id/revision was reused with different content"
            )
        if (
            current.plan_id == plan_id
            and current.revision is not None
            and revision <= current.revision
        ):
            if self._transport is not None:
                assert current.plan_content_sha256 is not None
                self._transport.accept_plan(
                    plan_id,
                    current.revision,
                    current.plan_content_sha256,
                )
            self.status = f"Plan {plan_id} r{current.revision}"
            self.error = ""
            return True
        if current.receipts:
            pending = self.pending_plan
            if (
                pending is not None
                and plan_id == pending.get("id")
                and revision == pending.get("revision")
                and self.pending_plan_content_sha256 != plan_content_sha256
            ):
                raise ValueError(
                    "Pending plan id/revision was reused with different content"
                )
            is_new_pending = (
                pending is None
                or plan_id != pending.get("id")
                or revision > pending.get("revision", 0)
            )
            if is_new_pending:
                self.pending_plan = plan
                self.pending_plan_content_sha256 = plan_content_sha256
            accepted = self.pending_plan or plan
            if self._transport is not None:
                assert self.pending_plan_content_sha256 is not None
                self._transport.accept_plan(
                    accepted["id"],
                    accepted["revision"],
                    self.pending_plan_content_sha256,
                )
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
        self._active_revision_lineage = None
        self._clear_revision_history()
        self.revision_history_error = ""
        if self._transport is not None:
            self._transport.follow_revision_thread(None)
        replace_session(replacement)
        if not preserve_provider_handoff:
            self._invalidate_handoff_for_plan_install()
        if (
            self.pending_plan is not None
            and self.pending_plan.get("id") == plan_id
            and self.pending_plan.get("revision") == revision
        ):
            self.pending_plan = None
            self.pending_plan_content_sha256 = None
        if self._transport is not None:
            assert plan_content_sha256 is not None
            self._transport.accept_plan(plan_id, revision, plan_content_sha256)
        self.status = f"Plan {plan_id} r{revision}"
        self.error = ""
        self._last_rejected_plan = None
        self.report("plan_loaded")
        return True

    def stage_proposal(
        self,
        proposal: dict[str, Any],
        proposal_plan_content_sha256: str | None = None,
    ) -> bool:
        """Validate an AI-authored proposal without replacing or executing a session."""
        if proposal_plan_content_sha256 is None:
            proposal_plan_content_sha256 = (
                self._delivered_proposal_plan_content_sha256
            )
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
            "goalRequestId",
            "revisionRequestId",
            "revisionThread",
            "planDiff",
            "catalogVersion",
            "targetInstanceId",
        }
        if not required_fields.issubset(proposal) or set(proposal) - (
            required_fields | optional_fields
        ):
            raise ValueError("Proposal fields do not match the versioned protocol")
        proposal_protocol_version = proposal.get("protocolVersion")
        if proposal_protocol_version not in SUPPORTED_PROTOCOL_VERSIONS:
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
        goal_request_id = proposal.get("goalRequestId")
        if goal_request_id is not None:
            if not isinstance(goal_request_id, str):
                raise ValueError("Proposal goal request id must be a UUID")
            try:
                uuid.UUID(goal_request_id)
            except ValueError as error:
                raise ValueError("Proposal goal request id must be a UUID") from error
            if revision_request_id is not None:
                raise ValueError(
                    "A proposal cannot link both a goal request and revision request"
                )
            if goal_request_id != self.goal_request.request_id:
                raise ValueError("Proposal does not match the active goal request")
            if proposal_protocol_version != PROTOCOL_VERSION:
                raise ValueError("Goal-linked proposals require protocol 1.1")
        revision_thread = proposal.get("revisionThread")
        if revision_thread is not None:
            if revision_request_id is None:
                raise ValueError(
                    "A standalone proposal cannot declare a revision thread"
                )
            validate_revision_thread(
                revision_thread,
                request_id=revision_request_id,
            )
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
        if (revision_request_id is not None or goal_request_id is not None) and (
            target_instance_id is None or catalog_version is None
        ):
            raise ValueError(
                "A request-linked proposal must declare catalog and target instance"
            )
        if proposal_protocol_version == PROTOCOL_VERSION:
            if "planDiff" not in proposal:
                raise ValueError("Protocol 1.1 proposals require a plan diff field")
            if revision_request_id is not None and (
                revision_thread is None or proposal.get("planDiff") is None
            ):
                raise ValueError(
                    "A request-linked proposal requires revision thread and plan diff"
                )
            if revision_request_id is None and proposal.get("planDiff") is not None:
                raise ValueError("A standalone proposal cannot declare a plan diff")
        proposed_at = proposal.get("proposedAt")
        if not isinstance(proposed_at, str):
            raise ValueError("Proposal timestamp must include a timezone")
        try:
            parsed_time = datetime.fromisoformat(proposed_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("Proposal timestamp must be an ISO date-time") from error
        if parsed_time.tzinfo is None:
            raise ValueError("Proposal timestamp must include a timezone")

        proposed_plan = proposal.get("plan")
        active_goal_payload = self.goal_request.payload
        if goal_request_id is not None and (
            active_goal_payload is None
            or not isinstance(proposed_plan, dict)
            or proposed_plan.get("id") != active_goal_payload["planId"]
        ):
            raise ValueError("Proposal plan id does not match the active goal request")
        replacement = self._validated_session(
            proposed_plan,
            proposal_plan_content_sha256,
        )
        validate_plan_diff(proposal.get("planDiff"), proposed_plan)
        candidate_key = (revision_request_id, proposal_id)
        existing_candidate = self._proposal_candidates.get(candidate_key)
        if existing_candidate is None:
            expected_provider_proposal_id = self.provider_handoff.proposal_id
            expected_provider_key = (
                self.provider_handoff.acknowledged_revision_request_id,
                expected_provider_proposal_id,
            )
            is_expected_provider = (
                expected_provider_proposal_id is not None
                and candidate_key == expected_provider_key
            )
            reserve_provider_slot = (
                expected_provider_proposal_id is None
                or expected_provider_key not in self._proposal_candidates
            )
            candidate_limit = (
                MAX_DEFERRED_PROPOSALS
                if is_expected_provider or not reserve_provider_slot
                else MAX_DEFERRED_PROPOSALS - 1
            )
            if len(self._proposal_candidates) >= candidate_limit:
                raise ProposalQueueFullError(
                    "Proposal review queue is full; review an existing proposal first"
                )
            self._proposal_candidates[candidate_key] = (proposal, replacement)
        else:
            if (
                existing_candidate[0] != proposal
                or existing_candidate[1].plan_content_sha256
                != replacement.plan_content_sha256
            ):
                raise ValueError(
                    "Proposal identity was reused with different content"
                )
            proposal, replacement = existing_candidate

        expected_provider_proposal_id = self.provider_handoff.proposal_id
        if (
            expected_provider_proposal_id is not None
            and (
                proposal_id != expected_provider_proposal_id
                or revision_request_id
                != self.provider_handoff.acknowledged_revision_request_id
            )
        ):
            return True
        if expected_provider_proposal_id is not None:
            return self._bind_provider_proposal()
        self._show_proposal(proposal, replacement)
        return True

    def _show_proposal(
        self, proposal: dict[str, Any], replacement: DemoSession
    ) -> None:
        proposal_id = proposal["proposalId"]
        revision_request_id = proposal.get("revisionRequestId")
        previous_proposal_session = self.proposal_session
        if self._revision_base_session is previous_proposal_session:
            self.clear_revision_draft()
        self.proposed_plan = proposal
        self.proposal_session = replacement
        proposal_lineage = lineage_from_proposal(proposal)
        if proposal_lineage is not None and self._transport is not None:
            self._transport.follow_revision_thread(proposal_lineage.thread_id)
        self._last_rejected_proposal = None
        self.error = ""
        self.status = (
            f"Plan proposal {replacement.plan_id} r{replacement.revision} awaiting review"
        )
        if (
            self.goal_request.active
            and proposal.get("goalRequestId") == self.goal_request.request_id
        ):
            self.goal_request.proposal_received()
        if (
            not self.provider_handoff.active
            and revision_request_id is not None
            and revision_request_id
            == self.provider_handoff.acknowledged_revision_request_id
            and (
                self.provider_handoff.generation_request_id is None
                or (
                    self.provider_handoff.phase == "proposal_created"
                    and proposal_id == self.provider_handoff.proposal_id
                )
            )
        ):
            self.provider_handoff.phase = "proposal_created"
            self.provider_handoff.proposal_id = proposal_id
            self.provider_handoff.message = (
                "Proposal delivered; review it before Accept or Reject"
            )

    def _bind_provider_proposal(self) -> bool:
        proposal_id = self.provider_handoff.proposal_id
        revision_request_id = self.provider_handoff.acknowledged_revision_request_id
        if proposal_id is None or revision_request_id is None:
            return False
        candidate = self._proposal_candidates.get(
            (revision_request_id, proposal_id)
        )
        if candidate is None:
            if (
                self.proposed_plan is not None
                and (
                    self.proposed_plan.get("proposalId") != proposal_id
                    or self.proposed_plan.get("revisionRequestId")
                    != revision_request_id
                )
            ):
                self.proposed_plan = None
                self.proposal_session = None
            return False
        for candidate_key in tuple(self._proposal_candidates):
            if candidate_key[1] == proposal_id and candidate_key != (
                revision_request_id,
                proposal_id,
            ):
                self._proposal_candidates.pop(candidate_key)
        self._show_proposal(*candidate)
        return True

    def _finish_proposal_review(
        self, proposal_id: str, revision_request_id: str | None
    ) -> None:
        self._proposal_candidates.pop((revision_request_id, proposal_id), None)
        if self._bind_provider_proposal():
            return
        if self._proposal_candidates:
            self._show_proposal(*next(reversed(self._proposal_candidates.values())))

    def accept_proposal(self) -> bool:
        """Install the staged proposal only when the active session owns no effects."""
        from .. import get_session

        proposal = self.proposed_plan
        if proposal is None or self.proposal_session is None:
            self.error = "No plan proposal is awaiting review"
            return False
        if self.provider_handoff.active:
            self.error = "Wait for the active provider run before deciding a proposal"
            return False
        expected_proposal_id = self.provider_handoff.proposal_id
        if (
            expected_proposal_id is not None
            and (
                proposal["proposalId"] != expected_proposal_id
                or proposal.get("revisionRequestId")
                != self.provider_handoff.acknowledged_revision_request_id
            )
        ):
            self.error = "Wait for the provider proposal before deciding deferred work"
            return False
        revision_request_id = proposal.get("revisionRequestId")
        if revision_request_id is not None:
            plan_diff = proposal.get("planDiff")
            if not isinstance(plan_diff, dict):
                self.error = (
                    "Cannot accept this request-linked proposal without a verifiable "
                    "base; request a protocol 1.1 proposal"
                )
                self.status = "Proposal base cannot be verified"
                return False
            active_session = get_session()
            base_plan = plan_diff["basePlan"]
            current_plan = {
                "id": active_session.plan_id,
                "revision": active_session.revision,
            }
            if base_plan != current_plan:
                self.error = (
                    "Plan proposal base changed: current "
                    f"{current_plan['id']} r{current_plan['revision']}, base "
                    f"{base_plan['id']} r{base_plan['revision']}"
                )
                self.status = "Plan proposal base changed"
                self.report("error", error=self.error)
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
        completes_goal_request = (
            self.goal_request.active
            and proposal.get("goalRequestId") == self.goal_request.request_id
        )
        accepted_lineage = lineage_from_proposal(proposal)
        accepted_session = self.proposal_session
        if not self.install_plan(
            proposal["plan"],
            plan_content_sha256=self.proposal_session.plan_content_sha256,
            preserve_provider_handoff=(
                expected_proposal_id == proposal_id
                and proposal.get("revisionRequestId")
                == self.provider_handoff.acknowledged_revision_request_id
            ),
        ):
            return False
        transport = self._transport
        decision = self._queue_proposal_decision(proposal_id, "accepted")
        self.proposed_plan = None
        self.proposal_session = None
        self._active_revision_lineage = accepted_lineage
        if transport is not None:
            transport.follow_revision_thread(
                accepted_lineage.thread_id if accepted_lineage is not None else None
            )
        self._last_rejected_proposal = None
        self.status = (
            f"Plan {get_session().plan_id} r{get_session().revision} accepted; "
            f"decision {decision['decisionId'][:8]} awaiting runtime acknowledgement"
        )
        self.error = ""
        if self._revision_base_session is accepted_session:
            self._revision_base_session = get_session()
            self._revision_reference_scope = "active"
        else:
            self.clear_revision_draft()
        self.provider_handoff.complete_proposal_review(
            proposal.get("revisionRequestId"), proposal_id
        )
        self._finish_proposal_review(
            proposal_id, proposal.get("revisionRequestId")
        )
        if completes_goal_request:
            self.goal_request.clear()
        return True

    def reject_proposal(self) -> bool:
        """Reject the staged proposal without changing the active session or scene."""
        from .. import get_session

        proposal = self.proposed_plan
        if proposal is None:
            self.error = "No plan proposal is awaiting review"
            return False
        if self.provider_handoff.active:
            self.error = "Wait for the active provider run before deciding a proposal"
            return False
        expected_proposal_id = self.provider_handoff.proposal_id
        if (
            expected_proposal_id is not None
            and (
                proposal["proposalId"] != expected_proposal_id
                or proposal.get("revisionRequestId")
                != self.provider_handoff.acknowledged_revision_request_id
            )
        ):
            self.error = "Wait for the provider proposal before deciding deferred work"
            return False
        rejected_session = self.proposal_session
        completes_goal_request = (
            self.goal_request.active
            and proposal.get("goalRequestId") == self.goal_request.request_id
        )
        decision = self._queue_proposal_decision(
            proposal["proposalId"], "rejected"
        )
        self.proposed_plan = None
        self.proposal_session = None
        if self._revision_base_session is rejected_session:
            self.clear_revision_draft()
        self._last_rejected_proposal = None
        session = get_session()
        self.status = (
            f"Plan {session.plan_id} r{session.revision}; rejected decision "
            f"{decision['decisionId'][:8]} awaiting runtime acknowledgement"
            if session.plan_id is not None and session.revision is not None
            else (
                f"Rejected decision {decision['decisionId'][:8]} awaiting runtime acknowledgement"
            )
        )
        self.error = ""
        self.provider_handoff.complete_proposal_review(
            proposal.get("revisionRequestId"), proposal["proposalId"]
        )
        self._finish_proposal_review(
            proposal["proposalId"], proposal.get("revisionRequestId")
        )
        if completes_goal_request:
            self.goal_request.clear()
        return True

    def pump(self) -> float | None:
        from .. import get_session

        self._reap_stopping_transports()
        if self.pending_plan is not None and not get_session().receipts:
            pending = self.pending_plan
            pending_content_sha256 = self.pending_plan_content_sha256
            try:
                self.install_plan(
                    pending,
                    plan_content_sha256=pending_content_sha256,
                )
            except (KeyError, TypeError, ValueError) as error:
                self.pending_plan = None
                self.pending_plan_content_sha256 = None
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
                        self.install_plan(
                            plan,
                            plan_content_sha256=message.get("planContentSha256"),
                        )
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
                    self._delivered_proposal_plan_content_sha256 = message.get(
                        "proposalPlanContentSha256"
                    )
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
                        if valid_proposal_id and not isinstance(
                            error, ProposalQueueFullError
                        ):
                            transport.quarantine_proposal(proposal_id)
                        rejection_fingerprint = (
                            proposal_id if valid_proposal_id else str(error),
                            str(error),
                        )
                        if rejection_fingerprint != self._last_rejected_proposal:
                            self._last_rejected_proposal = rejection_fingerprint
                            self.error = str(error)
                            self.status = (
                                "Proposal review queue full"
                                if isinstance(error, ProposalQueueFullError)
                                else "Plan proposal quarantined"
                            )
                            self.report("error", error=self.error)
                    finally:
                        self._delivered_proposal_plan_content_sha256 = None
                elif message.get("kind") == "revision_request_acknowledged":
                    request_id = message.get("requestId")
                    if isinstance(request_id, str):
                        self._acknowledge_revision_request(request_id)
                elif message.get("kind") == "goal_request_delivering":
                    self.goal_request.delivering(message.get("requestId"))
                elif message.get("kind") == "goal_request_acknowledged":
                    self.goal_request.acknowledged(message.get("requestId"))
                elif message.get("kind") == "goal_request_rejected":
                    detail = str(
                        message.get("message", "Goal request rejected")
                    ).strip()
                    if self.goal_request.delivery_rejected(
                        message.get("requestId"), detail
                    ):
                        self.error = detail
                        self.status = "Goal delivery rejected"
                elif message.get("kind") == "proposal_decision_acknowledged":
                    decision = message.get("decision")
                    decision_id = (
                        decision.get("decisionId")
                        if isinstance(decision, dict)
                        else None
                    )
                    pending = self._pending_proposal_decisions.get(decision_id)
                    if pending == decision:
                        self._pending_proposal_decisions.pop(decision_id, None)
                        session = get_session()
                        if decision.get("decision") == "accepted":
                            self.status = (
                                f"Plan {session.plan_id} r{session.revision} accepted"
                            )
                        elif session.plan_id is not None and session.revision is not None:
                            self.status = f"Plan {session.plan_id} r{session.revision}"
                        else:
                            self.status = "Connected" if self.connected else "Offline"
                        self.error = ""
                elif message.get("kind") == "replan_provider_list":
                    try:
                        self.provider_handoff.set_providers(message.get("providers"))
                    except (TypeError, ValueError) as error:
                        self.provider_handoff.loading_providers = False
                        self.provider_handoff.message = str(error)
                elif message.get("kind") == "replan_provider_list_unavailable":
                    self.provider_handoff.loading_providers = False
                    self.provider_handoff.message = str(
                        message.get("message", "Runtime provider discovery is unavailable")
                    )
                elif message.get("kind") == "replan_run_status":
                    try:
                        self.provider_handoff.apply_status(message.get("run"))
                        if self.provider_handoff.phase == "proposal_created":
                            self._bind_provider_proposal()
                    except (TypeError, ValueError) as error:
                        self.provider_handoff.phase = "failed"
                        self.provider_handoff.retry_mode = "never"
                        self.provider_handoff.message = str(error)
                        self.error = str(error)
                elif message.get("kind") == "replan_run_rejected":
                    try:
                        self.provider_handoff.reject_authorization(
                            message.get("generationRequestId"),
                            message.get("message"),
                        )
                    except (TypeError, ValueError) as error:
                        self.provider_handoff.message = str(error)
                        self.error = str(error)
                elif message.get("kind") == "revision_thread_history":
                    try:
                        history = validate_revision_thread_history(
                            message.get("history"),
                            instance_id=self.instance_id,
                        )
                        self._store_revision_history_page(history)
                        self.revision_history_error = ""
                    except (KeyError, TypeError, ValueError) as error:
                        self.revision_history_error = str(error)
                        self.error = str(error)
                        self.status = "Revision history rejected"
                        self.report("error", error=self.error)
                elif message.get("kind") == "revision_thread_history_unavailable":
                    self.revision_history_error = str(
                        message.get(
                            "message",
                            "Runtime revision history is unavailable",
                        )
                    )
                elif message.get("kind") == "error":
                    self.error = str(message.get("message", "Runtime connection error"))
                    self.status = "Connection error"
                    if self._pending_revision_request_ids:
                        self.revision_request_status = (
                            "Request queued locally; delivery will retry after reconnect"
                        )
                    self.goal_request.delivery_error(self.error)
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
            "planContentSha256": session.plan_content_sha256,
            "executionId": session.execution_id,
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
