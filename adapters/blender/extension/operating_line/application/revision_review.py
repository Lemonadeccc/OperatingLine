"""Pure validation and lineage helpers for immutable proposal review."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import re
import uuid
from typing import Any


NODE_NUMBER_PATTERN = re.compile(r"^[1-9]\d*(?:\.[1-9]\d*)*$")
PLAN_FIELDS = frozenset({"title", "rootStepId"})
STEP_FIELDS = frozenset(
    {
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
)
SUMMARY_FIELDS = frozenset(
    {"planFields", "addedSteps", "removedSteps", "updatedSteps", "movedSteps"}
)
REVISION_TURN_STATES = frozenset(
    {"awaiting_proposal", "awaiting_decision", "accepted", "rejected"}
)


@dataclass(frozen=True)
class RevisionLineage:
    thread_id: str
    turn: int
    request_id: str

    def next_payload(self, request_id: str) -> dict[str, Any]:
        _require_uuid(request_id, "Revision request id")
        return {
            "threadId": self.thread_id,
            "turn": self.turn + 1,
            "parentRequestId": self.request_id,
        }


def _require_uuid(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a UUID")
    try:
        uuid.UUID(value)
    except ValueError as error:
        raise ValueError(f"{label} must be a UUID") from error
    return value


def _require_nonnegative_integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def _require_positive_integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def validate_revision_thread(
    value: Any,
    *,
    request_id: str,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "threadId",
        "turn",
        "parentRequestId",
    }:
        raise ValueError("Proposal revision thread does not match the protocol")
    thread_id = _require_uuid(value.get("threadId"), "Revision thread id")
    turn = value.get("turn")
    if isinstance(turn, bool) or not isinstance(turn, int) or turn <= 0:
        raise ValueError("Revision thread turn must be a positive integer")
    parent_request_id = value.get("parentRequestId")
    if parent_request_id is not None:
        parent_request_id = _require_uuid(
            parent_request_id,
            "Revision thread parent request id",
        )
    if turn == 1:
        if parent_request_id is not None or thread_id != request_id:
            raise ValueError(
                "The first revision turn must use its request id and have no parent"
            )
    elif parent_request_id is None:
        raise ValueError("A continued revision turn requires a parent request")
    if parent_request_id == request_id:
        raise ValueError("A revision request cannot parent itself")
    return {
        "threadId": thread_id,
        "turn": turn,
        "parentRequestId": parent_request_id,
    }


def lineage_from_proposal(proposal: dict[str, Any]) -> RevisionLineage | None:
    request_id = proposal.get("revisionRequestId")
    thread = proposal.get("revisionThread")
    if thread is None:
        return None
    if request_id is None:
        raise ValueError("A revision thread requires a proposal request id")
    request_id = _require_uuid(request_id, "Proposal revision request id")
    validated = validate_revision_thread(thread, request_id=request_id)
    return RevisionLineage(
        thread_id=validated["threadId"],
        turn=validated["turn"],
        request_id=request_id,
    )


def new_revision_thread(
    request_id: str,
    lineage: RevisionLineage | None,
) -> dict[str, Any]:
    _require_uuid(request_id, "Revision request id")
    if lineage is not None:
        return lineage.next_payload(request_id)
    return {"threadId": request_id, "turn": 1, "parentRequestId": None}


def _validate_plan_reference(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"id", "revision"}:
        raise ValueError(f"{label} does not match the protocol")
    plan_id = value.get("id")
    revision = value.get("revision")
    if not isinstance(plan_id, str) or not plan_id:
        raise ValueError(f"{label} id must be a non-empty string")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision <= 0:
        raise ValueError(f"{label} revision must be a positive integer")
    return {"id": plan_id, "revision": revision}


def _validate_embedded_plan_identity(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    plan_id = value.get("id")
    revision = value.get("revision")
    if not isinstance(plan_id, str) or not plan_id:
        raise ValueError(f"{label} id must be a non-empty string")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision <= 0:
        raise ValueError(f"{label} revision must be a positive integer")
    return {"id": plan_id, "revision": revision}


def _validate_snapshot(value: Any, step_id: str, label: str) -> None:
    if not isinstance(value, dict) or set(value) != {
        "stepId",
        "nodeNumber",
        "parentId",
        "order",
        "title",
    }:
        raise ValueError(f"{label} snapshot does not match the protocol")
    if value.get("stepId") != step_id:
        raise ValueError(f"{label} snapshot must match step id")
    node_number = value.get("nodeNumber")
    if not isinstance(node_number, str) or NODE_NUMBER_PATTERN.fullmatch(node_number) is None:
        raise ValueError(f"{label} snapshot has an invalid node number")
    parent_id = value.get("parentId")
    if parent_id is not None and (not isinstance(parent_id, str) or not parent_id):
        raise ValueError(f"{label} snapshot has an invalid parent id")
    _require_nonnegative_integer(value.get("order"), f"{label} snapshot order")
    if not isinstance(value.get("title"), str) or not value["title"]:
        raise ValueError(f"{label} snapshot title must be non-empty")


def _validate_field_changes(value: Any, allowed: frozenset[str], label: str) -> list[dict]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    fields: set[str] = set()
    for change in value:
        if not isinstance(change, dict) or set(change) != {"field", "before", "after"}:
            raise ValueError(f"{label} entry does not match the protocol")
        field = change.get("field")
        if field not in allowed or field in fields:
            raise ValueError(f"{label} contains an unknown or repeated field")
        fields.add(field)
    return value


def validate_plan_diff(value: Any, target_plan: dict[str, Any]) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {
        "basePlan",
        "targetPlan",
        "summary",
        "planChanges",
        "stepChanges",
    }:
        raise ValueError("Proposal plan diff does not match the protocol")
    base = _validate_plan_reference(value.get("basePlan"), "Plan diff base")
    target = _validate_plan_reference(value.get("targetPlan"), "Plan diff target")
    if target != {"id": target_plan.get("id"), "revision": target_plan.get("revision")}:
        raise ValueError("Proposal plan diff target must match the proposed plan")
    if base["id"] != target["id"] or base["revision"] >= target["revision"]:
        raise ValueError("Proposal plan diff must compare newer revisions of one plan")

    summary = value.get("summary")
    if not isinstance(summary, dict) or set(summary) != SUMMARY_FIELDS:
        raise ValueError("Proposal plan diff summary does not match the protocol")
    for field in SUMMARY_FIELDS:
        _require_nonnegative_integer(summary.get(field), f"Plan diff summary {field}")
    plan_changes = _validate_field_changes(
        value.get("planChanges"),
        PLAN_FIELDS,
        "Plan diff plan changes",
    )
    if summary["planFields"] != len(plan_changes):
        raise ValueError("Proposal plan diff plan-field summary is inconsistent")

    step_changes = value.get("stepChanges")
    if not isinstance(step_changes, list):
        raise ValueError("Plan diff step changes must be an array")
    counts = {"added": 0, "removed": 0, "updated": 0, "moved": 0}
    step_ids: set[str] = set()
    for change in step_changes:
        if not isinstance(change, dict):
            raise ValueError("Plan diff step change must be an object")
        kind = change.get("kind")
        step_id = change.get("stepId")
        if not isinstance(step_id, str) or not step_id or step_id in step_ids:
            raise ValueError("Plan diff step ids must be non-empty and unique")
        step_ids.add(step_id)
        if kind == "added" and set(change) == {"kind", "stepId", "after"}:
            _validate_snapshot(change["after"], step_id, "Added step")
            counts["added"] += 1
        elif kind == "removed" and set(change) == {"kind", "stepId", "before"}:
            _validate_snapshot(change["before"], step_id, "Removed step")
            counts["removed"] += 1
        elif kind == "updated" and set(change) == {
            "kind",
            "stepId",
            "before",
            "after",
            "changes",
        }:
            _validate_snapshot(change["before"], step_id, "Updated step before")
            _validate_snapshot(change["after"], step_id, "Updated step after")
            fields = _validate_field_changes(
                change["changes"],
                STEP_FIELDS,
                "Plan diff step fields",
            )
            if not fields:
                raise ValueError("An updated step must contain changed fields")
            counts["updated"] += 1
            if any(item["field"] in {"parentId", "order"} for item in fields):
                counts["moved"] += 1
        else:
            raise ValueError("Plan diff step change does not match the protocol")

    expected = {
        "addedSteps": counts["added"],
        "removedSteps": counts["removed"],
        "updatedSteps": counts["updated"],
        "movedSteps": counts["moved"],
    }
    if any(summary[field] != count for field, count in expected.items()):
        raise ValueError("Proposal plan diff step summary is inconsistent")
    return deepcopy(value)


def _validate_history_request(
    value: Any,
    *,
    thread_id: str,
    turn: int,
    instance_id: str,
    plan_id: str,
) -> None:
    expected_fields = {
        "protocolVersion",
        "requestId",
        "adapterId",
        "catalogVersion",
        "instanceId",
        "basePlan",
        "references",
        "message",
        "revisionThread",
        "occurredAt",
    }
    if not isinstance(value, dict) or set(value) != expected_fields:
        raise ValueError("Revision history request does not match the protocol")
    if value.get("protocolVersion") != "1.1.0":
        raise ValueError("Revision history requires protocol 1.1 requests")
    request_id = _require_uuid(value.get("requestId"), "Revision history request id")
    if value.get("adapterId") != "blender" or value.get("instanceId") != instance_id:
        raise ValueError("Revision history request is outside this Blender instance")
    thread = validate_revision_thread(value.get("revisionThread"), request_id=request_id)
    if thread["threadId"] != thread_id or thread["turn"] != turn:
        raise ValueError("Revision history request uses the wrong thread turn")
    base_plan = _validate_embedded_plan_identity(
        value.get("basePlan"), "Revision history base plan"
    )
    if base_plan["id"] != plan_id:
        raise ValueError("Revision history cannot change plan id")
    message = value.get("message")
    if not isinstance(message, str) or not message.strip() or len(message) > 4000:
        raise ValueError("Revision history request message is invalid")
    references = value.get("references")
    if not isinstance(references, list) or not 1 <= len(references) <= 8:
        raise ValueError("Revision history request references are invalid")
    for reference in references:
        if not isinstance(reference, dict) or set(reference) != {
            "nodeId",
            "nodeNumber",
        }:
            raise ValueError("Revision history node reference does not match the protocol")
        if not isinstance(reference.get("nodeId"), str) or not reference["nodeId"]:
            raise ValueError("Revision history node reference id is invalid")
        node_number = reference.get("nodeNumber")
        if (
            not isinstance(node_number, str)
            or NODE_NUMBER_PATTERN.fullmatch(node_number) is None
        ):
            raise ValueError("Revision history node reference number is invalid")


def _validate_history_proposal(
    value: Any,
    *,
    request: dict[str, Any],
    thread_id: str,
    turn: int,
    instance_id: str,
    plan_id: str,
) -> None:
    required_fields = {
        "protocolVersion",
        "proposalId",
        "targetAdapterId",
        "targetInstanceId",
        "plan",
        "revisionRequestId",
        "revisionThread",
        "planDiff",
        "catalogVersion",
        "proposedAt",
    }
    if not isinstance(value, dict) or set(value) != required_fields:
        raise ValueError("Revision history proposal does not match the protocol")
    _require_uuid(value.get("proposalId"), "Revision history proposal id")
    if (
        value.get("protocolVersion") != "1.1.0"
        or value.get("targetAdapterId") != "blender"
        or value.get("targetInstanceId") != instance_id
        or value.get("revisionRequestId") != request.get("requestId")
    ):
        raise ValueError("Revision history proposal is outside its request scope")
    thread = validate_revision_thread(
        value.get("revisionThread"),
        request_id=request["requestId"],
    )
    if (
        thread["threadId"] != thread_id
        or thread["turn"] != turn
        or thread != request.get("revisionThread")
    ):
        raise ValueError("Revision history proposal uses the wrong thread turn")
    plan = value.get("plan")
    if not isinstance(plan, dict):
        raise ValueError("Revision history proposal plan must be an object")
    plan_reference = _validate_embedded_plan_identity(
        plan, "Revision history proposal plan"
    )
    if plan_reference["id"] != plan_id:
        raise ValueError("Revision history proposal cannot change plan id")
    validate_plan_diff(value.get("planDiff"), plan)


def _validate_history_decision(
    value: Any,
    *,
    proposal: dict[str, Any],
    instance_id: str,
) -> str:
    expected_fields = {
        "protocolVersion",
        "decisionId",
        "proposalId",
        "adapterId",
        "instanceId",
        "decision",
        "occurredAt",
    }
    if not isinstance(value, dict) or set(value) != expected_fields:
        raise ValueError("Revision history decision does not match the protocol")
    _require_uuid(value.get("decisionId"), "Revision history decision id")
    decision = value.get("decision")
    if (
        value.get("proposalId") != proposal.get("proposalId")
        or value.get("adapterId") != "blender"
        or value.get("instanceId") != instance_id
        or decision not in {"accepted", "rejected"}
    ):
        raise ValueError("Revision history decision is outside its proposal scope")
    return decision


def validate_revision_thread_history(
    value: Any,
    *,
    instance_id: str,
) -> dict[str, Any]:
    expected_fields = {
        "protocolVersion",
        "threadId",
        "targetAdapterId",
        "instanceId",
        "planId",
        "latestTurn",
        "status",
        "turns",
        "page",
    }
    if not isinstance(value, dict) or set(value) != expected_fields:
        raise ValueError("Revision thread history does not match the protocol")
    if value.get("protocolVersion") != "1.1.0":
        raise ValueError("Unsupported revision history protocol version")
    thread_id = _require_uuid(value.get("threadId"), "Revision history thread id")
    _require_uuid(instance_id, "Blender instance id")
    if value.get("targetAdapterId") != "blender" or value.get("instanceId") != instance_id:
        raise ValueError("Revision history targets a different Blender instance")
    plan_id = value.get("planId")
    if not isinstance(plan_id, str) or not plan_id:
        raise ValueError("Revision history plan id must be non-empty")
    latest_turn = _require_positive_integer(
        value.get("latestTurn"), "Revision history latest turn"
    )
    status = value.get("status")
    if status not in REVISION_TURN_STATES:
        raise ValueError("Revision history status is invalid")

    page = value.get("page")
    if not isinstance(page, dict) or set(page) != {
        "beforeTurn",
        "nextBeforeTurn",
        "hasMore",
    }:
        raise ValueError("Revision history page does not match the protocol")
    for field in ("beforeTurn", "nextBeforeTurn"):
        if page[field] is not None:
            _require_positive_integer(page[field], f"Revision history page {field}")
    if not isinstance(page.get("hasMore"), bool):
        raise ValueError("Revision history page hasMore must be boolean")

    turns = value.get("turns")
    if not isinstance(turns, list) or len(turns) > 100:
        raise ValueError("Revision history turns must be a bounded array")
    previous_turn = None
    previous_request_id = None
    for record in turns:
        if not isinstance(record, dict) or set(record) != {
            "turn",
            "state",
            "request",
            "proposal",
            "decision",
        }:
            raise ValueError("Revision history turn does not match the protocol")
        turn = _require_positive_integer(record.get("turn"), "Revision history turn")
        if previous_turn is not None and turn != previous_turn + 1:
            raise ValueError("Revision history page turns must be contiguous")
        if turn > latest_turn:
            raise ValueError("Revision history turn exceeds the latest turn")
        previous_turn = turn
        request = record.get("request")
        _validate_history_request(
            request,
            thread_id=thread_id,
            turn=turn,
            instance_id=instance_id,
            plan_id=plan_id,
        )
        if (
            previous_request_id is not None
            and request["revisionThread"]["parentRequestId"]
            != previous_request_id
        ):
            raise ValueError("Revision history page breaks its parent request chain")
        previous_request_id = request["requestId"]
        proposal = record.get("proposal")
        decision = record.get("decision")
        if proposal is None:
            expected_state = "awaiting_proposal"
            if decision is not None:
                raise ValueError("A revision history decision requires a proposal")
        else:
            _validate_history_proposal(
                proposal,
                request=request,
                thread_id=thread_id,
                turn=turn,
                instance_id=instance_id,
                plan_id=plan_id,
            )
            expected_state = "awaiting_decision"
            if decision is not None:
                expected_state = _validate_history_decision(
                    decision,
                    proposal=proposal,
                    instance_id=instance_id,
                )
        if record.get("state") != expected_state:
            raise ValueError("Revision history turn state is inconsistent")

    first_turn = turns[0]["turn"] if turns else None
    if page["beforeTurn"] is not None and any(
        record["turn"] >= page["beforeTurn"] for record in turns
    ):
        raise ValueError("Revision history page does not precede its cursor")
    if page["beforeTurn"] is None and turns and turns[-1]["turn"] != latest_turn:
        raise ValueError("Newest revision history page must include the latest turn")
    if page["hasMore"]:
        if first_turn is None or page["nextBeforeTurn"] != first_turn:
            raise ValueError("Revision history continuation cursor is inconsistent")
    elif page["nextBeforeTurn"] is not None:
        raise ValueError("Complete revision history page cannot have a cursor")
    if turns and turns[-1]["turn"] == latest_turn and turns[-1]["state"] != status:
        raise ValueError("Revision history latest status is inconsistent")
    return deepcopy(value)


__all__ = (
    "RevisionLineage",
    "lineage_from_proposal",
    "new_revision_thread",
    "validate_plan_diff",
    "validate_revision_thread",
    "validate_revision_thread_history",
)
