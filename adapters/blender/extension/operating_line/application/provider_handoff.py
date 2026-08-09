"""Explicit, review-gated planner-provider handoff state.

This module has no Blender or transport imports.  It validates the small host
contract and keeps provider execution state separate from scene/session state.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import re
from typing import Any
import uuid


TERMINAL_REPLAN_RUN_PHASES = frozenset(
    {"proposal_created", "needs_revision", "failed", "interrupted"}
)
PORTABLE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
SEMVER_PATTERN = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
PLANNER_ERROR_CODES = frozenset(
    {
        "planner_invalid_request",
        "planner_provider_not_found",
        "planner_provider_unavailable",
        "planner_replan_not_supported",
        "planner_revision_request_not_found",
        "planner_revision_request_not_pending",
        "planner_revision_thread_stale",
        "planner_replan_generation_stale",
        "planner_replan_submission_invalid",
        "planner_generation_busy",
        "planner_generation_conflict",
        "planner_generation_already_attempted",
        "planner_generation_timeout",
        "planner_runtime_stopping",
        "planner_provider_failed",
        "planner_output_invalid",
        "planner_identity_mismatch",
        "planner_catalog_invalid",
        "planner_persistence_failed",
        "planner_internal_failed",
    }
)
LOCAL_REPLAN_FINDING_CODES = frozenset(
    {
        "plan_structure_invalid",
        "plan_title_changed",
        "root_step_changed",
        "scope_root_missing",
        "scope_root_attachment_changed",
        "step_changed_outside_scope",
        "step_added_outside_scope",
        "step_moved_across_scope",
        "no_local_change",
    }
)
UUID_PATTERN = re.compile(
    r"^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|"
    r"00000000-0000-0000-0000-000000000000|"
    r"ffffffff-ffff-ffff-ffff-ffffffffffff)$"
)
RFC3339_DATETIME_PATTERN = re.compile(
    r"^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|"
    r"[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:"
    r"(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|"
    r"(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|"
    r"(?:02)-(?:0[1-9]|1\d|2[0-8])))T"
    r"(?:(?:[01]\d|2[0-3]):[0-5]\d"
    r"(?::[0-5]\d(?:\.\d+)?)?"
    r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))$"
)
REPLAN_RUN_PHASES = frozenset(
    {
        "idle",
        "queued",
        "generating",
        *TERMINAL_REPLAN_RUN_PHASES,
    }
)
INITIAL_PLAN_RUN_PHASES = REPLAN_RUN_PHASES


def _uuid(value: Any, label: str) -> str:
    if not isinstance(value, str) or UUID_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{label} must be a UUID")
    return value


def _rfc3339_datetime(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or RFC3339_DATETIME_PATTERN.fullmatch(value) is None
    ):
        raise ValueError(f"{label} must be an RFC 3339 date-time")
    return value


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be non-empty text")
    return value.strip()


def _bounded_text(value: Any, label: str, maximum: int) -> str:
    normalized = _text(value, label)
    if len(normalized) > maximum:
        raise ValueError(f"{label} must not exceed {maximum} characters")
    return normalized


def _portable_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or PORTABLE_ID_PATTERN.fullmatch(value) is None:
        raise ValueError(
            f"{label} must use [A-Za-z0-9][A-Za-z0-9._:-]*"
        )
    return value


def _string_list(
    value: Any, label: str, *, unique: bool = False
) -> list[str]:
    if not isinstance(value, list) or any(
        not isinstance(item, str) or PORTABLE_ID_PATTERN.fullmatch(item) is None
        for item in value
    ):
        raise ValueError(f"{label} must be a list of non-empty ids")
    if unique and len(set(value)) != len(value):
        raise ValueError(f"{label} ids must be unique")
    return value


def _validate_needs_revision_findings(needs_revision: dict[str, Any]) -> None:
    for finding in needs_revision["planning"]["findings"]:
        if not isinstance(finding, dict) or set(finding) != {
            "code",
            "severity",
            "message",
            "stepIds",
            "phaseIds",
        }:
            raise ValueError("Planning finding contains unsupported fields")
        _text(finding.get("code"), "Planning finding code")
        if finding.get("severity") not in {"error", "warning"}:
            raise ValueError("Planning finding severity is invalid")
        _text(finding.get("message"), "Planning finding message")
        _string_list(finding.get("stepIds"), "Planning finding step ids")
        _string_list(finding.get("phaseIds"), "Planning finding phase ids")
    for finding in needs_revision["locality"]["findings"]:
        if not isinstance(finding, dict) or set(finding) != {
            "code",
            "message",
            "stepIds",
        }:
            raise ValueError("Locality finding contains unsupported fields")
        if finding.get("code") not in LOCAL_REPLAN_FINDING_CODES:
            raise ValueError("Locality finding code is invalid")
        _text(finding.get("message"), "Locality finding message")
        _string_list(
            finding.get("stepIds"), "Locality finding step ids", unique=True
        )


def validate_provider_list(payload: Any) -> tuple[dict[str, Any], ...]:
    """Validate the public provider descriptors used by Blender's chooser."""
    if not isinstance(payload, dict):
        raise ValueError("Provider list must be a JSON object")
    if set(payload) != {"contractVersion", "generationAvailable", "providers"}:
        raise ValueError("Provider list contains unsupported fields")
    if payload.get("contractVersion") != "1.0.0":
        raise ValueError("Unsupported provider contract version")
    providers = payload.get("providers")
    if not isinstance(providers, list):
        raise ValueError("Provider list must contain providers")
    validated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for candidate in providers:
        if not isinstance(candidate, dict):
            raise ValueError("Provider descriptor must be a JSON object")
        if set(candidate) != {
            "contractVersion",
            "id",
            "version",
            "displayName",
            "description",
            "availability",
            "limits",
            "dataHandling",
        }:
            raise ValueError("Provider descriptor contains unsupported fields")
        if candidate.get("contractVersion") != "1.0.0":
            raise ValueError("Unsupported provider descriptor contract version")
        provider_id = _portable_id(candidate.get("id"), "Provider id")
        if provider_id in seen:
            raise ValueError("Provider ids must be unique")
        seen.add(provider_id)
        availability = candidate.get("availability")
        if not isinstance(availability, dict) or not isinstance(
            availability.get("available"), bool
        ):
            raise ValueError("Provider availability is invalid")
        expected_availability_fields = (
            {"available"}
            if availability.get("available")
            else {"available", "reason", "message"}
        )
        if set(availability) != expected_availability_fields:
            raise ValueError("Provider availability contains unsupported fields")
        if not availability.get("available"):
            if availability.get("reason") not in {
                "not_configured",
                "disabled",
                "temporarily_unavailable",
            }:
                raise ValueError("Provider unavailable reason is invalid")
            _bounded_text(
                availability.get("message"), "Provider unavailable message", 500
            )
        data_handling = candidate.get("dataHandling")
        if not isinstance(data_handling, dict):
            raise ValueError("Provider data handling is invalid")
        if set(data_handling) != {
            "executionLocation",
            "dataTransmission",
            "credentialManagement",
        }:
            raise ValueError("Provider data handling contains unsupported fields")
        execution_location = data_handling.get("executionLocation")
        if execution_location not in {"local", "remote"}:
            raise ValueError("Provider execution location is invalid")
        expected_transmission = (
            "none" if execution_location == "local" else "provider_managed"
        )
        if data_handling.get("dataTransmission") != expected_transmission:
            raise ValueError("Provider data transmission is invalid")
        if data_handling.get("credentialManagement") != "provider_managed":
            raise ValueError("Provider credential management is invalid")
        limits = candidate.get("limits")
        if (
            not isinstance(limits, dict)
            or set(limits) != {"maxConcurrency"}
            or isinstance(limits.get("maxConcurrency"), bool)
            or not isinstance(limits.get("maxConcurrency"), int)
            or not 1 <= limits["maxConcurrency"] <= 8
        ):
            raise ValueError("Provider concurrency limit is invalid")
        version = candidate.get("version")
        if not isinstance(version, str) or SEMVER_PATTERN.fullmatch(version) is None:
            raise ValueError("Provider version must use x.y.z")
        validated.append(
            {
                "id": provider_id,
                "version": version,
                "displayName": _bounded_text(
                    candidate.get("displayName"), "Provider display name", 180
                ),
                "description": _bounded_text(
                    candidate.get("description"), "Provider description", 1_000
                ),
                "availability": dict(availability),
                "dataHandling": dict(data_handling),
            }
        )
    generation_available = payload.get("generationAvailable")
    if not isinstance(generation_available, bool):
        raise ValueError("Provider list generation availability is invalid")
    if generation_available != any(
        provider["availability"]["available"] for provider in validated
    ):
        raise ValueError("Provider availability summary does not match providers")
    return tuple(validated)


@dataclass
class ReplanRunState:
    """Main-thread state for one explicitly authorized provider run."""

    providers: tuple[dict[str, Any], ...] = ()
    selected_provider_id: str | None = None
    acknowledged_revision_request_id: str | None = None
    pending_revision_request_id: str | None = None
    generation_request_id: str | None = None
    target_instance_id: str | None = None
    proposal_id: str | None = None
    phase: str = "idle"
    message: str = ""
    retry_mode: str | None = None
    needs_revision_summary: str = ""
    needs_revision_findings: tuple[str, ...] = ()
    loading_providers: bool = False
    _provider_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def selected_provider(self) -> dict[str, Any] | None:
        if self.selected_provider_id is None:
            return None
        return self._provider_by_id.get(self.selected_provider_id)

    @property
    def active(self) -> bool:
        return self.phase in {"queued", "generating"}

    @property
    def can_run(self) -> bool:
        provider = self.selected_provider
        retry_allowed = not (
            self.phase in {"failed", "interrupted"} and self.retry_mode == "never"
        )
        return bool(
            provider is not None
            and provider["availability"]["available"]
            and self.acknowledged_revision_request_id is not None
            and not self.active
            and self.phase != "proposal_created"
            and retry_allowed
        )

    def clear(self) -> None:
        self.providers = ()
        self._provider_by_id.clear()
        self.selected_provider_id = None
        self.acknowledged_revision_request_id = None
        self.pending_revision_request_id = None
        self.generation_request_id = None
        self.target_instance_id = None
        self.proposal_id = None
        self.phase = "idle"
        self.message = ""
        self.retry_mode = None
        self.needs_revision_summary = ""
        self.needs_revision_findings = ()
        self.loading_providers = False

    def set_providers(self, payload: Any) -> None:
        if self.active:
            raise ValueError("Provider descriptors are locked while a run is active")
        providers = validate_provider_list(payload)
        previous_selection = self.selected_provider
        self.providers = providers
        self._provider_by_id = {provider["id"]: provider for provider in providers}
        if self.selected_provider_id not in self._provider_by_id:
            self.selected_provider_id = None
        elif (
            previous_selection is not None
            and self.selected_provider["version"] != previous_selection["version"]
        ):
            self.selected_provider_id = None
        elif not self.selected_provider["availability"]["available"]:
            self.selected_provider_id = None
        self.loading_providers = False
        if not providers:
            self.message = "No replan provider is configured"

    def select(self, provider_id: str) -> dict[str, Any]:
        provider = self._provider_by_id.get(provider_id)
        if provider is None:
            raise ValueError("Select a provider returned by this runtime")
        if not provider["availability"]["available"]:
            reason = provider["availability"].get("message", "Provider unavailable")
            raise ValueError(str(reason))
        if self.active:
            raise ValueError("Provider selection is locked while a run is active")
        if (
            (
                self.selected_provider_id is None
                or provider_id != self.selected_provider_id
            )
            and self.phase in {"needs_revision", "failed", "interrupted"}
        ):
            self.generation_request_id = None
            self.target_instance_id = None
            self.phase = "idle"
            self.retry_mode = None
            self.needs_revision_summary = ""
            self.needs_revision_findings = ()
        self.selected_provider_id = provider_id
        self.message = f"Selected {provider['displayName']}"
        return provider

    def revision_submitted(self, request_id: str | None = None) -> None:
        self.ensure_revision_submission_allowed()
        self.acknowledged_revision_request_id = None
        self.pending_revision_request_id = (
            _uuid(request_id, "Pending revision request id")
            if request_id is not None
            else None
        )
        self.generation_request_id = None
        self.target_instance_id = None
        self.proposal_id = None
        self.phase = "idle"
        self.retry_mode = None
        self.needs_revision_summary = ""
        self.needs_revision_findings = ()
        self.message = "Waiting for runtime request acknowledgement"

    def revision_acknowledged(self, request_id: Any) -> None:
        validated_request_id = _uuid(
            request_id, "Acknowledged revision request id"
        )
        if validated_request_id == self.acknowledged_revision_request_id:
            return
        if validated_request_id != self.pending_revision_request_id:
            raise ValueError(
                "Runtime acknowledged an older revision request or unknown/stale request"
            )
        self.acknowledged_revision_request_id = validated_request_id
        self.pending_revision_request_id = None
        self.generation_request_id = None
        self.target_instance_id = None
        self.proposal_id = None
        self.phase = "idle"
        self.retry_mode = None
        self.needs_revision_summary = ""
        self.needs_revision_findings = ()
        self.message = "Revision request is ready for an optional provider run"

    def complete_proposal_review(
        self, revision_request_id: Any, proposal_id: Any
    ) -> bool:
        if self.active:
            return False
        if (
            self.acknowledged_revision_request_id is None
            or revision_request_id != self.acknowledged_revision_request_id
        ):
            return False
        if self.proposal_id is not None and proposal_id != self.proposal_id:
            return False
        self.acknowledged_revision_request_id = None
        self.pending_revision_request_id = None
        self.generation_request_id = None
        self.target_instance_id = None
        self.proposal_id = None
        self.phase = "idle"
        self.retry_mode = None
        self.needs_revision_summary = ""
        self.needs_revision_findings = ()
        self.message = "Create a new revision request for another provider run"
        return True

    def invalidate_for_plan_install(self) -> bool:
        if self.active:
            return False
        had_revision_context = any(
            value is not None
            for value in (
                self.acknowledged_revision_request_id,
                self.pending_revision_request_id,
                self.generation_request_id,
            )
        )
        if not had_revision_context:
            return False
        self.acknowledged_revision_request_id = None
        self.pending_revision_request_id = None
        self.generation_request_id = None
        self.target_instance_id = None
        self.proposal_id = None
        self.phase = "idle"
        self.retry_mode = None
        self.needs_revision_summary = ""
        self.needs_revision_findings = ()
        self.message = "Installed plan requires a new revision request"
        return True

    def ensure_revision_submission_allowed(self) -> None:
        if self.active:
            raise ValueError(
                "Wait for the active provider run to finish before sending another request"
            )

    def ensure_provider_refresh_allowed(self) -> None:
        if self.active:
            raise ValueError("Wait for the active provider run before refreshing providers")

    def begin(self, *, target_instance_id: str) -> dict[str, Any]:
        if not self.can_run:
            raise ValueError(
                "Select an available provider after the runtime acknowledges the request"
            )
        provider = self.selected_provider
        assert provider is not None
        revision_request_id = self.acknowledged_revision_request_id
        assert revision_request_id is not None
        target_instance_id = _uuid(target_instance_id, "Target instance id")
        generation_request_id = str(uuid.uuid4())
        self.generation_request_id = generation_request_id
        self.target_instance_id = target_instance_id
        self.proposal_id = None
        self.phase = "queued"
        self.retry_mode = None
        self.needs_revision_summary = ""
        self.needs_revision_findings = ()
        self.message = "Provider run queued; scene and active plan are unchanged"
        return {
            "generationRequestId": generation_request_id,
            "revisionRequestId": revision_request_id,
            "providerId": provider["id"],
            "providerVersion": provider["version"],
            "targetAdapterId": "blender",
            "targetInstanceId": target_instance_id,
            "authorization": {
                "disclosureVersion": "1.0.0",
                "dataHandlingAcknowledged": True,
                "possibleChargesAcknowledged": True,
                "proposalCreationAcknowledged": True,
                "authorizedAt": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            },
        }

    def reject_authorization(self, generation_request_id: Any, message: Any) -> None:
        rejected_id = _uuid(generation_request_id, "Rejected generation request id")
        if rejected_id != self.generation_request_id:
            raise ValueError("Runtime rejected a different provider run")
        self.phase = "failed"
        self.retry_mode = "never"
        self.needs_revision_summary = ""
        self.needs_revision_findings = ()
        self.proposal_id = None
        self.message = (
            message.strip()
            if isinstance(message, str) and message.strip()
            else "Runtime rejected this provider authorization"
        )

    def apply_status(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            raise ValueError("Replan run status must be a JSON object")
        if set(payload) != {
            "contractVersion",
            "generationRequestId",
            "revisionRequestId",
            "targetAdapterId",
            "targetInstanceId",
            "provider",
            "status",
            "terminal",
            "sceneChanged",
            "proposalId",
            "error",
            "needsRevision",
            "updatedAt",
        }:
            raise ValueError("Replan run status contains unsupported fields")
        if payload.get("contractVersion") != "1.0.0":
            raise ValueError("Unsupported replan run contract version")
        generation_request_id = _uuid(
            payload.get("generationRequestId"), "Run generation request id"
        )
        revision_request_id = _uuid(
            payload.get("revisionRequestId"), "Run revision request id"
        )
        if generation_request_id != self.generation_request_id:
            raise ValueError("Runtime returned status for a different provider run")
        if revision_request_id != self.acknowledged_revision_request_id:
            raise ValueError("Runtime returned status for a different revision request")
        if payload.get("targetAdapterId") != "blender":
            raise ValueError("Runtime returned status for a different adapter")
        if payload.get("targetInstanceId") != self.target_instance_id:
            raise ValueError("Runtime returned status for a different Blender instance")
        provider = payload.get("provider")
        selected = self.selected_provider
        if (
            not isinstance(provider, dict)
            or set(provider) != {"id", "version", "displayName"}
            or selected is None
            or provider.get("id") != selected["id"]
            or provider.get("version") != selected["version"]
            or _bounded_text(
                provider.get("displayName"), "Run provider display name", 180
            )
            != selected["displayName"]
        ):
            raise ValueError("Runtime returned status for a different provider")
        if payload.get("sceneChanged") is not False:
            raise ValueError("Runtime did not preserve the scene-change safety invariant")
        _rfc3339_datetime(payload.get("updatedAt"), "Replan run update timestamp")
        phase = payload.get("status")
        if phase not in REPLAN_RUN_PHASES - {"idle"}:
            raise ValueError("Runtime returned an unsupported replan run status")
        terminal = payload.get("terminal")
        if terminal is not (phase in TERMINAL_REPLAN_RUN_PHASES):
            raise ValueError("Runtime replan terminal marker does not match status")
        proposal_id = payload.get("proposalId")
        if phase == "proposal_created":
            _uuid(proposal_id, "Created proposal id")
        elif proposal_id is not None:
            raise ValueError("Only a created proposal may contain a proposal id")
        safe_error = payload.get("error")
        if phase in {"failed", "interrupted"}:
            if not isinstance(safe_error, dict) or set(safe_error) != {
                "code",
                "retryMode",
                "message",
            }:
                raise ValueError("Failed replan run must contain a safe error")
            if safe_error.get("code") not in PLANNER_ERROR_CODES:
                raise ValueError("Replan error code is invalid")
            if safe_error.get("retryMode") not in {
                "new_request_id",
                "never",
            }:
                raise ValueError(
                    "Terminal replan retry mode must use a new request id or never"
                )
            _bounded_text(safe_error.get("message"), "Replan error message", 500)
        elif safe_error is not None:
            raise ValueError("Only failed replan runs may contain an error")
        needs_revision = payload.get("needsRevision")
        if phase == "needs_revision":
            if not isinstance(needs_revision, dict) or set(needs_revision) != {
                "planning",
                "locality",
                "planDiffAvailable",
            }:
                raise ValueError("Needs-revision status must contain safe findings")
            planning = needs_revision.get("planning")
            locality = needs_revision.get("locality")
            if (
                not isinstance(planning, dict)
                or set(planning) != {"errorCount", "warningCount", "findings"}
                or not isinstance(planning.get("findings"), list)
                or not isinstance(locality, dict)
                or set(locality) != {"valid", "findings"}
                or not isinstance(locality.get("valid"), bool)
                or not isinstance(locality.get("findings"), list)
                or not isinstance(needs_revision.get("planDiffAvailable"), bool)
            ):
                raise ValueError("Needs-revision findings are invalid")
            for count_name in ("errorCount", "warningCount"):
                count = planning.get(count_name)
                if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                    raise ValueError("Needs-revision finding counts are invalid")
            _validate_needs_revision_findings(needs_revision)
            planning_error_count = sum(
                finding["severity"] == "error"
                for finding in planning["findings"]
            )
            planning_warning_count = len(planning["findings"]) - planning_error_count
            if (
                planning["errorCount"] != planning_error_count
                or planning["warningCount"] != planning_warning_count
            ):
                raise ValueError("Needs-revision planning counts are inconsistent")
            locality_valid = locality["valid"]
            if locality_valid is not (len(locality["findings"]) == 0):
                raise ValueError(
                    "Needs-revision locality validity is inconsistent"
                )
            if (
                planning_error_count == 0
                and locality_valid
                and needs_revision["planDiffAvailable"]
            ):
                raise ValueError(
                    "Needs-revision evidence has no deterministic blocking condition"
                )
        elif needs_revision is not None:
            raise ValueError("Only needs-revision runs may contain findings")
        self.phase = phase
        self.proposal_id = proposal_id if phase == "proposal_created" else None
        self.retry_mode = (
            safe_error.get("retryMode") if isinstance(safe_error, dict) else None
        )
        self.needs_revision_summary = (
            f"{needs_revision['planning']['errorCount']} planning errors, "
            f"{needs_revision['planning']['warningCount']} warnings, "
            f"{len(needs_revision['locality']['findings'])} locality findings"
            if isinstance(needs_revision, dict)
            else ""
        )
        finding_values = (
            [
                *needs_revision["planning"]["findings"],
                *needs_revision["locality"]["findings"],
            ]
            if isinstance(needs_revision, dict)
            else []
        )
        self.needs_revision_findings = tuple(
            finding["message"].strip()
            for finding in finding_values
            if isinstance(finding, dict)
            and isinstance(finding.get("message"), str)
            and finding["message"].strip()
        )[:3]
        detail = safe_error.get("message") if isinstance(safe_error, dict) else None
        self.message = (
            detail.strip()
            if isinstance(detail, str) and detail.strip()
            else {
                "queued": "Provider run queued",
                "generating": "Provider is generating a revised plan",
                "proposal_created": "Proposal created; waiting for review delivery",
                "needs_revision": "Provider output needs another explicitly authorized run",
                "failed": "Provider run failed; retry requires confirmation",
                "interrupted": "Provider run was interrupted; retry requires confirmation",
            }[phase]
        )


@dataclass
class InitialPlanRunState:
    """Main-thread state for one explicitly authorized initial-plan run."""

    providers: tuple[dict[str, Any], ...] = ()
    selected_provider_id: str | None = None
    acknowledged_goal_request_id: str | None = None
    generation_request_id: str | None = None
    target_instance_id: str | None = None
    proposal_id: str | None = None
    phase: str = "idle"
    message: str = ""
    retry_mode: str | None = None
    needs_revision_summary: str = ""
    needs_revision_findings: tuple[str, ...] = ()
    loading_providers: bool = False
    _provider_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def selected_provider(self) -> dict[str, Any] | None:
        if self.selected_provider_id is None:
            return None
        return self._provider_by_id.get(self.selected_provider_id)

    @property
    def active(self) -> bool:
        return self.phase in {"queued", "generating"}

    @property
    def can_run(self) -> bool:
        provider = self.selected_provider
        retry_allowed = not (
            self.phase in {"failed", "interrupted"} and self.retry_mode == "never"
        )
        return bool(
            provider is not None
            and provider["availability"]["available"]
            and self.acknowledged_goal_request_id is not None
            and not self.active
            and self.phase != "proposal_created"
            and retry_allowed
        )

    def clear(self) -> None:
        self.providers = ()
        self._provider_by_id.clear()
        self.selected_provider_id = None
        self.acknowledged_goal_request_id = None
        self.generation_request_id = None
        self.target_instance_id = None
        self.proposal_id = None
        self.phase = "idle"
        self.message = ""
        self.retry_mode = None
        self.needs_revision_summary = ""
        self.needs_revision_findings = ()
        self.loading_providers = False

    def set_providers(self, payload: Any) -> None:
        if self.active:
            raise ValueError("Provider descriptors are locked while a run is active")
        providers = validate_provider_list(payload)
        previous_selection = self.selected_provider
        self.providers = providers
        self._provider_by_id = {provider["id"]: provider for provider in providers}
        if self.selected_provider_id not in self._provider_by_id:
            self.selected_provider_id = None
        elif (
            previous_selection is not None
            and self.selected_provider["version"] != previous_selection["version"]
        ):
            self.selected_provider_id = None
        elif not self.selected_provider["availability"]["available"]:
            self.selected_provider_id = None
        self.loading_providers = False
        if not providers:
            self.message = "No initial planner provider is configured"

    def select(self, provider_id: str) -> dict[str, Any]:
        provider = self._provider_by_id.get(provider_id)
        if provider is None:
            raise ValueError("Select a provider returned by this runtime")
        if not provider["availability"]["available"]:
            raise ValueError(
                str(provider["availability"].get("message", "Provider unavailable"))
            )
        if self.active:
            raise ValueError("Provider selection is locked while a run is active")
        if (
            (
                self.selected_provider_id is None
                or provider_id != self.selected_provider_id
            )
            and self.phase in {"needs_revision", "failed", "interrupted"}
        ):
            self.generation_request_id = None
            self.target_instance_id = None
            self.phase = "idle"
            self.retry_mode = None
            self.needs_revision_summary = ""
            self.needs_revision_findings = ()
        self.selected_provider_id = provider_id
        self.message = f"Selected {provider['displayName']}"
        return provider

    def goal_acknowledged(self, goal_request_id: Any) -> None:
        validated = _uuid(goal_request_id, "Acknowledged goal request id")
        if self.acknowledged_goal_request_id not in {None, validated}:
            self.clear()
        self.acknowledged_goal_request_id = validated
        if self.phase == "idle":
            self.message = "Goal request is ready for an optional provider run"

    def ensure_provider_refresh_allowed(self) -> None:
        if self.active:
            raise ValueError("Wait for the active initial-plan run before refreshing providers")

    def begin(self, *, target_instance_id: str) -> dict[str, Any]:
        if not self.can_run:
            raise ValueError(
                "Select an available provider after the runtime acknowledges the goal"
            )
        provider = self.selected_provider
        goal_request_id = self.acknowledged_goal_request_id
        assert provider is not None and goal_request_id is not None
        generation_request_id = str(uuid.uuid4())
        self.generation_request_id = generation_request_id
        self.target_instance_id = _uuid(target_instance_id, "Target instance id")
        self.proposal_id = None
        self.phase = "queued"
        self.retry_mode = None
        self.needs_revision_summary = ""
        self.needs_revision_findings = ()
        self.message = "Initial planner run queued; scene and active plan are unchanged"
        return {
            "generationRequestId": generation_request_id,
            "goalRequestId": goal_request_id,
            "providerId": provider["id"],
            "providerVersion": provider["version"],
            "targetAdapterId": "blender",
            "targetInstanceId": self.target_instance_id,
            "authorization": {
                "disclosureVersion": "1.0.0",
                "dataHandlingAcknowledged": True,
                "possibleChargesAcknowledged": True,
                "proposalCreationAcknowledged": True,
                "authorizedAt": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            },
        }

    def reject_authorization(self, generation_request_id: Any, message: Any) -> None:
        rejected_id = _uuid(generation_request_id, "Rejected generation request id")
        if rejected_id != self.generation_request_id:
            raise ValueError("Runtime rejected a different initial-plan run")
        self.phase = "failed"
        self.retry_mode = "never"
        self.proposal_id = None
        self.message = (
            message.strip()
            if isinstance(message, str) and message.strip()
            else "Runtime rejected this initial planner authorization"
        )

    def complete_proposal_review(self, goal_request_id: Any, proposal_id: Any) -> bool:
        if self.active:
            return False
        if (
            self.acknowledged_goal_request_id is None
            or goal_request_id != self.acknowledged_goal_request_id
        ):
            return False
        if self.proposal_id is not None and proposal_id != self.proposal_id:
            return False
        self.clear()
        self.message = "Create a new goal request for another initial planner run"
        return True

    def apply_status(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            raise ValueError("Initial-plan run status must be a JSON object")
        if set(payload) != {
            "contractVersion",
            "generationRequestId",
            "goalRequestId",
            "targetAdapterId",
            "targetInstanceId",
            "provider",
            "status",
            "terminal",
            "sceneChanged",
            "proposalId",
            "error",
            "needsRevision",
            "updatedAt",
        }:
            raise ValueError("Initial-plan run status contains unsupported fields")
        if payload.get("contractVersion") != "1.0.0":
            raise ValueError("Unsupported initial-plan run contract version")
        generation_request_id = _uuid(
            payload.get("generationRequestId"), "Run generation request id"
        )
        goal_request_id = _uuid(payload.get("goalRequestId"), "Run goal request id")
        if generation_request_id != self.generation_request_id:
            raise ValueError("Runtime returned status for a different initial-plan run")
        if goal_request_id != self.acknowledged_goal_request_id:
            raise ValueError("Runtime returned status for a different goal request")
        if payload.get("targetAdapterId") != "blender":
            raise ValueError("Runtime returned status for a different adapter")
        if payload.get("targetInstanceId") != self.target_instance_id:
            raise ValueError("Runtime returned status for a different Blender instance")
        provider = payload.get("provider")
        selected = self.selected_provider
        if (
            not isinstance(provider, dict)
            or set(provider) != {"id", "version", "displayName"}
            or selected is None
            or provider.get("id") != selected["id"]
            or provider.get("version") != selected["version"]
            or _bounded_text(
                provider.get("displayName"), "Run provider display name", 180
            )
            != selected["displayName"]
        ):
            raise ValueError("Runtime returned status for a different provider")
        if payload.get("sceneChanged") is not False:
            raise ValueError("Runtime did not preserve the scene-change safety invariant")
        _rfc3339_datetime(payload.get("updatedAt"), "Initial-plan run update timestamp")
        phase = payload.get("status")
        if phase not in INITIAL_PLAN_RUN_PHASES - {"idle"}:
            raise ValueError("Runtime returned an unsupported initial-plan run status")
        terminal = payload.get("terminal")
        if terminal is not (phase in TERMINAL_REPLAN_RUN_PHASES):
            raise ValueError("Runtime initial-plan terminal marker does not match status")
        proposal_id = payload.get("proposalId")
        if phase == "proposal_created":
            _uuid(proposal_id, "Created proposal id")
        elif proposal_id is not None:
            raise ValueError("Only a created proposal may contain a proposal id")
        safe_error = payload.get("error")
        if phase in {"failed", "interrupted"}:
            if not isinstance(safe_error, dict) or set(safe_error) != {
                "code",
                "retryMode",
                "message",
            }:
                raise ValueError("Failed initial-plan run must contain a safe error")
            if safe_error.get("code") not in PLANNER_ERROR_CODES:
                raise ValueError("Initial-plan error code is invalid")
            if safe_error.get("retryMode") not in {"new_request_id", "never"}:
                raise ValueError("Terminal retry mode must use a new request id or never")
            _bounded_text(safe_error.get("message"), "Initial-plan error message", 500)
        elif safe_error is not None:
            raise ValueError("Only failed initial-plan runs may contain an error")
        needs_revision = payload.get("needsRevision")
        if phase == "needs_revision":
            if not isinstance(needs_revision, dict) or set(needs_revision) != {"planning"}:
                raise ValueError("Needs-revision status must contain planning findings")
            planning = needs_revision.get("planning")
            if (
                not isinstance(planning, dict)
                or set(planning) != {"errorCount", "warningCount", "findings"}
                or not isinstance(planning.get("findings"), list)
            ):
                raise ValueError("Needs-revision planning findings are invalid")
            for count_name in ("errorCount", "warningCount"):
                count = planning.get(count_name)
                if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                    raise ValueError("Needs-revision finding counts are invalid")
            if planning["errorCount"] == 0:
                raise ValueError("Needs-revision planning must contain an error")
            for finding in planning["findings"]:
                if not isinstance(finding, dict) or set(finding) != {
                    "code",
                    "severity",
                    "message",
                    "stepIds",
                    "phaseIds",
                }:
                    raise ValueError("Planning finding contains unsupported fields")
                _text(finding.get("code"), "Planning finding code")
                if finding.get("severity") not in {"error", "warning"}:
                    raise ValueError("Planning finding severity is invalid")
                _text(finding.get("message"), "Planning finding message")
                _string_list(finding.get("stepIds"), "Planning finding step ids")
                _string_list(finding.get("phaseIds"), "Planning finding phase ids")
            error_count = sum(
                finding["severity"] == "error" for finding in planning["findings"]
            )
            if (
                planning["errorCount"] != error_count
                or planning["warningCount"] != len(planning["findings"]) - error_count
            ):
                raise ValueError("Needs-revision planning counts are inconsistent")
            if not planning["findings"]:
                raise ValueError("Needs-revision evidence has no planning finding")
        elif needs_revision is not None:
            raise ValueError("Only needs-revision runs may contain findings")
        self.phase = phase
        self.proposal_id = proposal_id if phase == "proposal_created" else None
        self.retry_mode = (
            safe_error.get("retryMode") if isinstance(safe_error, dict) else None
        )
        planning = needs_revision.get("planning") if isinstance(needs_revision, dict) else None
        self.needs_revision_summary = (
            f"{planning['errorCount']} planning errors, "
            f"{planning['warningCount']} warnings"
            if isinstance(planning, dict)
            else ""
        )
        self.needs_revision_findings = tuple(
            finding["message"].strip()
            for finding in planning["findings"]
            if isinstance(finding.get("message"), str) and finding["message"].strip()
        )[:3] if isinstance(planning, dict) else ()
        detail = safe_error.get("message") if isinstance(safe_error, dict) else None
        self.message = (
            detail.strip()
            if isinstance(detail, str) and detail.strip()
            else {
                "queued": "Initial planner run queued",
                "generating": "Provider is generating an initial plan",
                "proposal_created": "Proposal created; waiting for review delivery",
                "needs_revision": "Provider output needs another explicitly authorized run",
                "failed": "Initial planner run failed; retry requires confirmation",
                "interrupted": "Initial planner run was interrupted; retry requires confirmation",
            }[phase]
        )


__all__ = (
    "INITIAL_PLAN_RUN_PHASES",
    "InitialPlanRunState",
    "REPLAN_RUN_PHASES",
    "ReplanRunState",
    "TERMINAL_REPLAN_RUN_PHASES",
    "validate_provider_list",
)
