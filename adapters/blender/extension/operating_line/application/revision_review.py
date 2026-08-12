"""Pure validation and lineage helpers for immutable proposal review."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import json
import re
import uuid
from typing import Any

from ..domain import PROTOCOL_VERSION

NODE_NUMBER_PATTERN = re.compile(r"^[1-9]\d*(?:\.[1-9]\d*)*$")
ARGUMENT_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
REVISION_PROTOCOL_VERSIONS = frozenset(
    {"1.1.0", "1.2.0", "1.3.0", "1.4.0", PROTOCOL_VERSION}
)
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
        "observationPolicy",
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


def _canonical_json(value: Any, label: str) -> str:
    def validate(candidate: Any) -> None:
        if candidate is None or isinstance(candidate, (bool, str)):
            return
        if isinstance(candidate, (int, float)) and not isinstance(candidate, bool):
            return
        if isinstance(candidate, list):
            for item in candidate:
                validate(item)
            return
        if isinstance(candidate, dict) and all(
            isinstance(key, str) for key in candidate
        ):
            for item in candidate.values():
                validate(item)
            return
        raise ValueError(f"{label} must be JSON data")

    validate(value)
    try:
        return json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be finite JSON data") from error


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


def validate_revision_operation(
    value: Any,
    *,
    thread: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("kind") not in {
        "revise",
        "fork",
        "merge",
    }:
        raise ValueError("Revision operation does not match the protocol")
    kind = value["kind"]
    if kind == "revise":
        if set(value) != {"kind"}:
            raise ValueError("Revise operation does not match the protocol")
        return {"kind": kind}
    if set(value) != {"kind", "sourceThreadId", "sourceRequestId"}:
        raise ValueError(f"{kind.capitalize()} operation does not match the protocol")
    source_thread_id = _require_uuid(
        value.get("sourceThreadId"), "Revision source thread id"
    )
    source_request_id = _require_uuid(
        value.get("sourceRequestId"), "Revision source request id"
    )
    if source_thread_id == thread["threadId"]:
        raise ValueError("Revision source must use a different branch")
    if kind == "fork" and thread["turn"] != 1:
        raise ValueError("A fork must start a new revision thread at turn 1")
    if kind == "merge" and thread["turn"] <= 1:
        raise ValueError("A merge must continue an existing target branch")
    return {
        "kind": kind,
        "sourceThreadId": source_thread_id,
        "sourceRequestId": source_request_id,
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
    required_fields = {
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
    if not isinstance(value, dict) or not required_fields.issubset(value):
        raise ValueError("Revision history request does not match the protocol")
    protocol_version = value.get("protocolVersion")
    if protocol_version not in REVISION_PROTOCOL_VERSIONS:
        raise ValueError("Revision history requires protocol 1.1+ requests")
    parameter_edits = value.get("parameterEdits")
    expected_fields = required_fields | (
        {"parameterEdits"} if "parameterEdits" in value else set()
    ) | (
        {"revisionOperation"} if "revisionOperation" in value else set()
    )
    if set(value) != expected_fields:
        raise ValueError("Revision history request does not match the protocol")
    if (
        protocol_version not in {"1.3.0", "1.4.0", PROTOCOL_VERSION}
        and "parameterEdits" in value
    ):
        raise ValueError("Structured revision edits require protocol 1.3+")
    request_id = _require_uuid(value.get("requestId"), "Revision history request id")
    if value.get("adapterId") != "blender" or value.get("instanceId") != instance_id:
        raise ValueError("Revision history request is outside this Blender instance")
    thread = validate_revision_thread(value.get("revisionThread"), request_id=request_id)
    if thread["threadId"] != thread_id or thread["turn"] != turn:
        raise ValueError("Revision history request uses the wrong thread turn")
    operation = value.get("revisionOperation")
    if protocol_version in {"1.4.0", PROTOCOL_VERSION}:
        validate_revision_operation(operation, thread=thread)
    elif operation is not None:
        raise ValueError("Explicit revision operations require protocol 1.4+")
    if (
        isinstance(operation, dict)
        and operation.get("kind") == "merge"
        and parameter_edits is not None
    ):
        raise ValueError("A deterministic branch merge cannot include parameter edits")
    base_plan_value = value.get("basePlan")
    base_plan = _validate_embedded_plan_identity(
        base_plan_value, "Revision history base plan"
    )
    if base_plan["id"] != plan_id:
        raise ValueError("Revision history cannot change plan id")
    message = value.get("message")
    if (
        not isinstance(message, str)
        or len(message) > 4000
        or (not message.strip() and parameter_edits is None)
    ):
        raise ValueError("Revision history request message is invalid")
    references = value.get("references")
    if not isinstance(references, list) or not 1 <= len(references) <= 8:
        raise ValueError("Revision history request references are invalid")
    referenced_node_ids: set[str] = set()
    for reference in references:
        if not isinstance(reference, dict) or set(reference) != {
            "nodeId",
            "nodeNumber",
        }:
            raise ValueError("Revision history node reference does not match the protocol")
        if not isinstance(reference.get("nodeId"), str) or not reference["nodeId"]:
            raise ValueError("Revision history node reference id is invalid")
        referenced_node_ids.add(reference["nodeId"])
        node_number = reference.get("nodeNumber")
        if (
            not isinstance(node_number, str)
            or NODE_NUMBER_PATTERN.fullmatch(node_number) is None
        ):
            raise ValueError("Revision history node reference number is invalid")

    if parameter_edits is None:
        return
    if not isinstance(parameter_edits, list) or not 1 <= len(parameter_edits) <= 64:
        raise ValueError("Revision history parameter edits are invalid")
    base_steps = {
        step.get("id"): step
        for step in base_plan_value.get("steps", [])
        if isinstance(step, dict) and isinstance(step.get("id"), str)
    }
    edit_keys: set[tuple[str, str]] = set()
    for edit in parameter_edits:
        if not isinstance(edit, dict) or set(edit) != {
            "nodeId",
            "argumentName",
            "before",
            "after",
        }:
            raise ValueError("Revision history parameter edit does not match the protocol")
        node_id = edit.get("nodeId")
        argument_name = edit.get("argumentName")
        if node_id not in referenced_node_ids:
            raise ValueError("Revision history parameter edit requires a direct reference")
        if (
            not isinstance(argument_name, str)
            or len(argument_name) > 180
            or ARGUMENT_NAME_PATTERN.fullmatch(argument_name) is None
        ):
            raise ValueError("Revision history parameter argument name is invalid")
        edit_key = (node_id, argument_name)
        if edit_key in edit_keys:
            raise ValueError("Revision history parameter edits must be unique")
        edit_keys.add(edit_key)
        before = _canonical_json(edit.get("before"), "Revision parameter before")
        after = _canonical_json(edit.get("after"), "Revision parameter after")
        if before == after:
            raise ValueError("Revision history parameter edit must change its value")
        base_step = base_steps.get(node_id)
        if base_step is None:
            continue
        action = base_step.get("action")
        arguments = action.get("arguments") if isinstance(action, dict) else None
        if not isinstance(arguments, dict) or argument_name not in arguments:
            raise ValueError("Revision history parameter edit targets an unknown argument")
        if _canonical_json(
            arguments[argument_name], "Revision parameter base value"
        ) != before:
            raise ValueError("Revision history parameter before value does not match the base")


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
    if not isinstance(value, dict):
        raise ValueError("Revision history proposal does not match the protocol")
    expected_fields = required_fields | (
        {"revisionOperation"} if "revisionOperation" in value else set()
    ) | ({"mergeBaseRequestId"} if "mergeBaseRequestId" in value else set())
    if set(value) != expected_fields:
        raise ValueError("Revision history proposal does not match the protocol")
    _require_uuid(value.get("proposalId"), "Revision history proposal id")
    if (
        value.get("protocolVersion") not in REVISION_PROTOCOL_VERSIONS
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
    request_operation = request.get("revisionOperation")
    proposal_operation = value.get("revisionOperation")
    if request_operation is None:
        operation_matches = proposal_operation is None or proposal_operation == {
            "kind": "revise"
        }
    else:
        operation_matches = proposal_operation == request_operation
    if not operation_matches:
        raise ValueError("Revision history proposal must preserve its request operation")
    if proposal_operation is not None:
        validate_revision_operation(proposal_operation, thread=thread)
    merge_base_request_id = value.get("mergeBaseRequestId")
    if isinstance(proposal_operation, dict) and proposal_operation.get("kind") == "merge":
        _require_uuid(
            merge_base_request_id,
            "Revision history merge common ancestor request id",
        )
    elif merge_base_request_id is not None:
        raise ValueError("Only a merge proposal can declare a common ancestor")
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
        value.get("protocolVersion") not in REVISION_PROTOCOL_VERSIONS
        or value.get("proposalId") != proposal.get("proposalId")
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
    if value.get("protocolVersion") not in REVISION_PROTOCOL_VERSIONS:
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


def validate_revision_branch_list(
    value: Any,
    *,
    instance_id: str,
    plan_id: str,
) -> dict[str, Any]:
    expected_fields = {
        "protocolVersion",
        "targetAdapterId",
        "instanceId",
        "planId",
        "branches",
    }
    if not isinstance(value, dict) or set(value) != expected_fields:
        raise ValueError("Revision branch list does not match the protocol")
    if value.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("Revision branches require the current protocol")
    if (
        value.get("targetAdapterId") != "blender"
        or value.get("instanceId") != instance_id
        or value.get("planId") != plan_id
    ):
        raise ValueError("Revision branch list is outside this Blender Plan")
    branches = value.get("branches")
    if not isinstance(branches, list) or len(branches) > 100:
        raise ValueError("Revision branch list must be a bounded array")
    thread_ids: set[str] = set()
    for branch in branches:
        if not isinstance(branch, dict) or set(branch) != {
            "threadId",
            "headRequestId",
            "headTurn",
            "status",
            "operation",
            "plan",
            "planContentSha256",
            "occurredAt",
        }:
            raise ValueError("Revision branch entry does not match the protocol")
        thread_id = _require_uuid(branch.get("threadId"), "Revision branch id")
        if thread_id in thread_ids:
            raise ValueError("Revision branch list repeats a thread")
        thread_ids.add(thread_id)
        head_request_id = _require_uuid(
            branch.get("headRequestId"), "Revision branch head request id"
        )
        head_turn = _require_positive_integer(
            branch.get("headTurn"), "Revision branch head turn"
        )
        if head_turn == 1 and head_request_id != thread_id:
            raise ValueError(
                "The first revision branch head must use its thread id as request id"
            )
        status = branch.get("status")
        if status not in REVISION_TURN_STATES:
            raise ValueError("Revision branch status is invalid")
        validate_revision_operation(
            branch.get("operation"),
            thread={"threadId": thread_id, "turn": head_turn},
        )
        plan = branch.get("plan")
        content_sha256 = branch.get("planContentSha256")
        if status == "accepted":
            reference = _validate_embedded_plan_identity(
                plan, "Revision branch accepted Plan"
            )
            if reference["id"] != plan_id:
                raise ValueError("Revision branch Plan id does not match")
            if (
                not isinstance(content_sha256, str)
                or re.fullmatch(r"[0-9a-f]{64}", content_sha256) is None
            ):
                raise ValueError("Revision branch Plan hash is invalid")
        elif plan is not None or content_sha256 is not None:
            raise ValueError("Only an accepted branch can expose an installable Plan")
        if not isinstance(branch.get("occurredAt"), str) or not branch["occurredAt"]:
            raise ValueError("Revision branch timestamp is invalid")
    return deepcopy(value)


__all__ = (
    "RevisionLineage",
    "lineage_from_proposal",
    "new_revision_thread",
    "validate_plan_diff",
    "validate_revision_branch_list",
    "validate_revision_operation",
    "validate_revision_thread",
    "validate_revision_thread_history",
)
