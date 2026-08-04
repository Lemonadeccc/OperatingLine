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


__all__ = (
    "RevisionLineage",
    "lineage_from_proposal",
    "new_revision_thread",
    "validate_plan_diff",
    "validate_revision_thread",
)
