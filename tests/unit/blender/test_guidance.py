"""Pure Python tests for deterministic Blender guidance state."""

from copy import deepcopy
from importlib import import_module
import sys
import unittest
import uuid
from pathlib import Path
from types import ModuleType, SimpleNamespace


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_guidance_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line

application = import_module(f"{PACKAGE_NAME}.application")
domain = import_module(f"{PACKAGE_NAME}.domain")
visual_theme = import_module(f"{PACKAGE_NAME}.visual_theme")
GuidanceState = application.GuidanceState
InitialPlanRunState = application.InitialPlanRunState
DemoSession = application.DemoSession
RevisionLineage = application.RevisionLineage
ReplanRunState = application.ReplanRunState
lineage_from_proposal = application.lineage_from_proposal
new_revision_thread = application.new_revision_thread
node_state = application.node_state
relevant_steps = application.relevant_steps
step_state = application.step_state
validate_plan_diff = application.validate_plan_diff
validate_provider_list = application.validate_provider_list
validate_revision_thread_history = application.validate_revision_thread_history
ActionSpec = domain.ActionSpec
TaskNode = domain.TaskNode
STATE_COLORS = visual_theme.STATE_COLORS
STATE_SYMBOLS = visual_theme.STATE_SYMBOLS


def provider_list(*, available: bool = True) -> dict:
    return {
        "contractVersion": "1.0.0",
        "generationAvailable": available,
        "providers": [
            {
                "contractVersion": "1.0.0",
                "id": "fake-planner",
                "version": "0.1.0",
                "displayName": "Fake Planner",
                "description": "Deterministic provider used by host handoff tests.",
                "availability": {
                    "available": available,
                    **(
                        {}
                        if available
                        else {
                            "reason": "not_configured",
                            "message": "Missing provider credential",
                        }
                    ),
                },
                "limits": {"maxConcurrency": 1},
                "dataHandling": {
                    "executionLocation": "remote",
                    "dataTransmission": "provider_managed",
                    "credentialManagement": "provider_managed",
                },
            }
        ],
    }


def replan_run_status(
    state: ReplanRunState,
    status: str,
    *,
    proposal_id: str | None = None,
    error: dict | None = None,
    needs_revision: dict | None = None,
) -> dict:
    provider = state.selected_provider
    assert provider is not None
    return {
        "contractVersion": "1.0.0",
        "generationRequestId": state.generation_request_id,
        "revisionRequestId": state.acknowledged_revision_request_id,
        "targetAdapterId": "blender",
        "targetInstanceId": state.target_instance_id,
        "provider": {
            "id": provider["id"],
            "version": provider["version"],
            "displayName": provider["displayName"],
        },
        "status": status,
        "terminal": status not in {"queued", "generating"},
        "sceneChanged": False,
        "proposalId": proposal_id,
        "error": error,
        "needsRevision": needs_revision,
        "updatedAt": "2026-08-05T12:00:01.000Z",
    }


def initial_plan_run_status(
    state: InitialPlanRunState,
    status: str,
    *,
    proposal_id: str | None = None,
    error: dict | None = None,
    needs_revision: dict | None = None,
) -> dict:
    provider = state.selected_provider
    assert provider is not None
    return {
        "contractVersion": "1.0.0",
        "generationRequestId": state.generation_request_id,
        "goalRequestId": state.acknowledged_goal_request_id,
        "targetAdapterId": "blender",
        "targetInstanceId": state.target_instance_id,
        "provider": {
            "id": provider["id"],
            "version": provider["version"],
            "displayName": provider["displayName"],
        },
        "status": status,
        "terminal": status not in {"queued", "generating"},
        "sceneChanged": False,
        "proposalId": proposal_id,
        "error": error,
        "needsRevision": needs_revision,
        "updatedAt": "2026-08-09T12:00:01.000Z",
    }


def action_node(node_id: str, number: str, order: int) -> TaskNode:
    return TaskNode(
        id=node_id,
        number=number,
        title=node_id,
        order=order,
        action=ActionSpec("test", f"run_{node_id}", {}),
    )


def acknowledge_revision(
    state: ReplanRunState, request_id: str | None = None
) -> str:
    acknowledged_id = request_id or str(uuid.uuid4())
    state.revision_submitted(acknowledged_id)
    state.revision_acknowledged(acknowledged_id)
    return acknowledged_id


class GuidanceStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.steps = tuple(
            action_node(f"step-{index}", f"1.{index + 1}", index)
            for index in range(6)
        )
        self.session = SimpleNamespace(steps=self.steps, active_index=-1)

    def test_initial_state_has_only_a_next_step(self) -> None:
        self.assertEqual(step_state(self.session, 0), GuidanceState.NEXT)
        self.assertEqual(step_state(self.session, 1), GuidanceState.LOCKED)
        self.assertEqual(
            tuple((item.index, item.state) for item in relevant_steps(self.session)),
            ((0, GuidanceState.NEXT),),
        )

    def test_active_step_is_back_and_window_preserves_execution_order(self) -> None:
        self.session.active_index = 3

        self.assertEqual(step_state(self.session, self.steps[2]), GuidanceState.COMPLETED)
        self.assertEqual(step_state(self.session, self.steps[3]), GuidanceState.BACK)
        self.assertEqual(step_state(self.session, self.steps[4]), GuidanceState.NEXT)
        self.assertEqual(step_state(self.session, self.steps[5]), GuidanceState.LOCKED)
        self.assertEqual(
            tuple((item.index, item.state) for item in relevant_steps(self.session)),
            (
                (1, GuidanceState.COMPLETED),
                (2, GuidanceState.COMPLETED),
                (3, GuidanceState.BACK),
                (4, GuidanceState.NEXT),
            ),
        )

    def test_completed_plan_keeps_latest_completed_steps_and_back_target(self) -> None:
        self.session.active_index = len(self.steps) - 1

        self.assertEqual(
            tuple((item.index, item.state) for item in relevant_steps(self.session)),
            (
                (2, GuidanceState.COMPLETED),
                (3, GuidanceState.COMPLETED),
                (4, GuidanceState.COMPLETED),
                (5, GuidanceState.BACK),
            ),
        )

    def test_group_state_tracks_back_next_completed_and_locked_descendants(self) -> None:
        first_group = TaskNode(
            id="first-group",
            number="1.1",
            title="First",
            order=0,
            children=self.steps[:3],
        )
        second_group = TaskNode(
            id="second-group",
            number="1.2",
            title="Second",
            order=1,
            children=self.steps[3:],
        )
        root = TaskNode(
            id="root",
            number="1",
            title="Root",
            order=0,
            children=(first_group, second_group),
        )

        self.assertEqual(node_state(self.session, root), GuidanceState.NEXT)
        self.assertEqual(node_state(self.session, second_group), GuidanceState.LOCKED)

        self.session.active_index = 2
        self.assertEqual(node_state(self.session, first_group), GuidanceState.BACK)
        self.assertEqual(node_state(self.session, second_group), GuidanceState.NEXT)
        self.assertEqual(node_state(self.session, root), GuidanceState.BACK)

        self.session.active_index = 3
        self.assertEqual(node_state(self.session, first_group), GuidanceState.COMPLETED)
        self.assertEqual(node_state(self.session, second_group), GuidanceState.BACK)

    def test_invalid_session_indices_and_limits_fail_loudly(self) -> None:
        self.session.active_index = len(self.steps)
        with self.assertRaisesRegex(ValueError, "active_index"):
            relevant_steps(self.session)

        self.session.active_index = -1
        with self.assertRaisesRegex(ValueError, "positive"):
            relevant_steps(self.session, limit=0)
        with self.assertRaisesRegex(ValueError, "not part"):
            step_state(self.session, len(self.steps))

    def test_every_state_has_a_distinct_color_and_text_symbol(self) -> None:
        self.assertEqual(set(STATE_COLORS), set(GuidanceState))
        self.assertEqual(set(STATE_SYMBOLS), set(GuidanceState))
        self.assertEqual(len(set(STATE_COLORS.values())), len(GuidanceState))
        self.assertEqual(len(set(STATE_SYMBOLS.values())), len(GuidanceState))
        self.assertEqual(STATE_SYMBOLS[GuidanceState.BACK], "BACK")
        self.assertEqual(STATE_SYMBOLS[GuidanceState.NEXT], "NEXT")


class ProviderHandoffTests(unittest.TestCase):

    def test_provider_refresh_never_selects_a_default(self) -> None:
        state = ReplanRunState()

        state.set_providers(provider_list())

        self.assertEqual(state.selected_provider_id, None)
        self.assertFalse(state.can_run)
        self.assertEqual(len(state.providers), 1)

    def test_unavailable_provider_cannot_be_selected(self) -> None:
        state = ReplanRunState()
        state.set_providers(provider_list(available=False))

        with self.assertRaisesRegex(ValueError, "Missing provider credential"):
            state.select("fake-planner")

        self.assertEqual(state.selected_provider_id, None)
        self.assertFalse(state.can_run)

    def test_new_revision_request_resets_the_acknowledgement_gate(self) -> None:
        state = ReplanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        request_id = str(uuid.uuid4())
        acknowledge_revision(state, request_id)
        self.assertTrue(state.can_run)

        state.revision_submitted()

        self.assertEqual(state.acknowledged_revision_request_id, None)
        self.assertFalse(state.can_run)
        self.assertIn("Waiting for runtime", state.message)

    def test_each_retry_creates_a_new_explicit_authorization(self) -> None:
        state = ReplanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        acknowledge_revision(state)

        first = state.begin(target_instance_id=str(uuid.uuid4()))
        state.apply_status(
            replan_run_status(
                state,
                "failed",
                error={
                    "code": "planner_provider_failed",
                    "retryMode": "new_request_id",
                    "message": "Planner provider failed before a proposal was created",
                },
            )
        )
        second = state.begin(target_instance_id=str(uuid.uuid4()))

        self.assertNotEqual(first["generationRequestId"], second["generationRequestId"])
        self.assertEqual(first["revisionRequestId"], second["revisionRequestId"])
        for request in (first, second):
            self.assertEqual(
                request["authorization"],
                {
                    "disclosureVersion": "1.0.0",
                    "dataHandlingAcknowledged": True,
                    "possibleChargesAcknowledged": True,
                    "proposalCreationAcknowledged": True,
                    "authorizedAt": request["authorization"]["authorizedAt"],
                },
            )

    def test_proposal_created_status_opens_the_host_review_gate(self) -> None:
        state = ReplanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        acknowledge_revision(state)
        state.begin(target_instance_id=str(uuid.uuid4()))
        proposal_id = str(uuid.uuid4())

        state.apply_status(
            replan_run_status(
                state,
                "proposal_created",
                proposal_id=proposal_id,
            )
        )

        self.assertEqual(state.phase, "proposal_created")
        self.assertFalse(state.active)
        self.assertFalse(state.can_run)
        self.assertIn("waiting for review", state.message)

    def test_never_retry_errors_keep_the_run_gate_closed(self) -> None:
        for phase in ("failed", "interrupted"):
            state = ReplanRunState()
            state.set_providers(provider_list())
            state.select("fake-planner")
            acknowledge_revision(state)
            state.begin(target_instance_id=str(uuid.uuid4()))

            state.apply_status(
                replan_run_status(
                    state,
                    phase,
                    error={
                        "code": "planner_generation_conflict",
                        "retryMode": "never",
                        "message": "This authorization cannot be retried",
                    },
                )
            )

            self.assertEqual(state.retry_mode, "never")
            self.assertFalse(state.can_run)

    def test_changed_provider_descriptor_requires_a_new_explicit_run(self) -> None:
        state = ReplanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        acknowledge_revision(state)
        request = state.begin(target_instance_id=str(uuid.uuid4()))
        state.reject_authorization(
            request["generationRequestId"], "Selected provider version is stale"
        )
        self.assertEqual(state.retry_mode, "never")
        self.assertFalse(state.can_run)

        refreshed = provider_list()
        refreshed["providers"][0]["version"] = "0.2.0"
        state.set_providers(refreshed)
        self.assertIsNone(state.selected_provider_id)
        state.select("fake-planner")

        self.assertEqual(state.phase, "idle")
        self.assertIsNone(state.retry_mode)
        self.assertTrue(state.can_run)

    def test_newer_pending_request_rejects_an_older_acknowledgement(self) -> None:
        state = ReplanRunState()
        older_request_id = str(uuid.uuid4())
        newer_request_id = str(uuid.uuid4())
        state.revision_submitted(older_request_id)
        state.revision_submitted(newer_request_id)

        with self.assertRaisesRegex(ValueError, "older revision request"):
            state.revision_acknowledged(older_request_id)

        self.assertEqual(state.pending_revision_request_id, newer_request_id)
        self.assertEqual(state.acknowledged_revision_request_id, None)

    def test_needs_revision_keeps_only_three_safe_findings(self) -> None:
        state = ReplanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        acknowledge_revision(state)
        state.begin(target_instance_id=str(uuid.uuid4()))
        planning_findings = [
            {
                "code": "missing_required_phase",
                "severity": "error" if index < 2 else "warning",
                "message": f"Safe finding {index}",
                "stepIds": [],
                "phaseIds": [],
            }
            for index in range(3)
        ]
        locality_findings = [
            {
                "code": "step_changed_outside_scope",
                "message": f"Safe finding {index}",
                "stepIds": [],
            }
            for index in range(3, 5)
        ]

        state.apply_status(
            replan_run_status(
                state,
                "needs_revision",
                needs_revision={
                    "planning": {
                        "errorCount": 2,
                        "warningCount": 1,
                        "findings": planning_findings,
                    },
                    "locality": {
                        "valid": False,
                        "findings": locality_findings,
                    },
                    "planDiffAvailable": False,
                },
            )
        )

        self.assertEqual(
            state.needs_revision_summary,
            "2 planning errors, 1 warnings, 2 locality findings",
        )
        self.assertEqual(
            state.needs_revision_findings,
            ("Safe finding 0", "Safe finding 1", "Safe finding 2"),
        )

    def test_status_for_another_run_is_rejected_without_changing_local_state(self) -> None:
        state = ReplanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        acknowledge_revision(state)
        state.begin(target_instance_id=str(uuid.uuid4()))
        before = state.phase
        payload = replan_run_status(state, "generating")
        payload["generationRequestId"] = str(uuid.uuid4())

        with self.assertRaisesRegex(ValueError, "different provider run"):
            state.apply_status(payload)

        self.assertEqual(state.phase, before)

    def test_provider_list_contract_is_strict_about_availability_and_transmission(self) -> None:
        mismatched_summary = provider_list()
        mismatched_summary["generationAvailable"] = False
        with self.assertRaisesRegex(ValueError, "summary"):
            validate_provider_list(mismatched_summary)

        unsafe_transmission = provider_list()
        unsafe_transmission["providers"][0]["dataHandling"]["dataTransmission"] = "none"
        with self.assertRaisesRegex(ValueError, "transmission"):
            validate_provider_list(unsafe_transmission)

    def test_provider_wire_rejects_invalid_ids_versions_lengths_and_errors(self) -> None:
        invalid_id = provider_list()
        invalid_id["providers"][0]["id"] = "invalid provider"
        with self.assertRaisesRegex(ValueError, "A-Za-z0-9"):
            validate_provider_list(invalid_id)

        invalid_version = provider_list()
        invalid_version["providers"][0]["version"] = "01.0.0"
        with self.assertRaisesRegex(ValueError, "x.y.z"):
            validate_provider_list(invalid_version)

        padded_version = provider_list()
        padded_version["providers"][0]["version"] = " 1.0.0 "
        with self.assertRaisesRegex(ValueError, "x.y.z"):
            validate_provider_list(padded_version)

        oversized_name = provider_list()
        oversized_name["providers"][0]["displayName"] = "x" * 181
        with self.assertRaisesRegex(ValueError, "180"):
            validate_provider_list(oversized_name)

        oversized_description = provider_list()
        oversized_description["providers"][0]["description"] = "x" * 1_001
        with self.assertRaisesRegex(ValueError, "1000"):
            validate_provider_list(oversized_description)

        state = ReplanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        acknowledge_revision(state)
        state.begin(target_instance_id=str(uuid.uuid4()))
        invalid_error = replan_run_status(
            state,
            "failed",
            error={
                "code": "not_a_public_error",
                "retryMode": "never",
                "message": "Safe but unknown error",
            },
        )
        with self.assertRaisesRegex(ValueError, "error code"):
            state.apply_status(invalid_error)

        invalid_provider_name = replan_run_status(state, "generating")
        invalid_provider_name["provider"]["displayName"] = 42
        with self.assertRaisesRegex(ValueError, "display name"):
            state.apply_status(invalid_provider_name)

    def test_needs_revision_rejects_inconsistent_planning_counts(self) -> None:
        state = ReplanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        acknowledge_revision(state)
        state.begin(target_instance_id=str(uuid.uuid4()))
        payload = replan_run_status(
            state,
            "needs_revision",
            needs_revision={
                "planning": {
                    "errorCount": 0,
                    "warningCount": 0,
                    "findings": [
                        {
                            "code": "missing_required_phase",
                            "severity": "error",
                            "message": "Required phase missing",
                            "stepIds": [],
                            "phaseIds": [],
                        }
                    ],
                },
                "locality": {"valid": True, "findings": []},
                "planDiffAvailable": False,
            },
        )
        with self.assertRaisesRegex(ValueError, "counts are inconsistent"):
            state.apply_status(payload)

    def test_needs_revision_rejects_invalid_locality_and_no_blocker(self) -> None:
        state = ReplanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        acknowledge_revision(state)
        state.begin(target_instance_id=str(uuid.uuid4()))
        locality_finding = {
            "code": "not_a_locality_code",
            "message": "Invalid public code",
            "stepIds": [],
        }
        invalid_code = replan_run_status(
            state,
            "needs_revision",
            needs_revision={
                "planning": {"errorCount": 0, "warningCount": 0, "findings": []},
                "locality": {"valid": False, "findings": [locality_finding]},
                "planDiffAvailable": False,
            },
        )
        with self.assertRaisesRegex(ValueError, "Locality finding code"):
            state.apply_status(invalid_code)

        inconsistent_locality = deepcopy(invalid_code)
        inconsistent_locality["needsRevision"]["locality"] = {
            "valid": False,
            "findings": [],
        }
        with self.assertRaisesRegex(ValueError, "locality validity"):
            state.apply_status(inconsistent_locality)

        no_blocker = deepcopy(inconsistent_locality)
        no_blocker["needsRevision"]["locality"]["valid"] = True
        no_blocker["needsRevision"]["planDiffAvailable"] = True
        with self.assertRaisesRegex(ValueError, "no deterministic blocking"):
            state.apply_status(no_blocker)

    def test_run_wire_rejects_noncanonical_uuid_and_datetime_forms(self) -> None:
        state = ReplanRunState()
        canonical_request_id = str(uuid.uuid4())
        for invalid_uuid in (
            canonical_request_id.replace("-", ""),
            "{" + canonical_request_id + "}",
        ):
            with self.assertRaisesRegex(ValueError, "must be a UUID"):
                state.revision_acknowledged(invalid_uuid)

        state.set_providers(provider_list())
        state.select("fake-planner")
        acknowledge_revision(state, canonical_request_id)
        state.begin(target_instance_id=str(uuid.uuid4()))
        for invalid_datetime in (
            "2026-08-05 12:00:01+00:00",
            "2026-02-30T12:00:01Z",
        ):
            payload = replan_run_status(state, "generating")
            payload["updatedAt"] = invalid_datetime
            with self.assertRaisesRegex(ValueError, "RFC 3339"):
                state.apply_status(payload)

        invalid_generation_id = replan_run_status(state, "generating")
        invalid_generation_id["generationRequestId"] = state.generation_request_id.replace(
            "-", ""
        )
        with self.assertRaisesRegex(ValueError, "must be a UUID"):
            state.apply_status(invalid_generation_id)

    def test_terminal_run_rejects_same_generation_id_retry_mode(self) -> None:
        state = ReplanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        acknowledge_revision(state)
        state.begin(target_instance_id=str(uuid.uuid4()))
        payload = replan_run_status(
            state,
            "failed",
            error={
                "code": "planner_generation_timeout",
                "retryMode": "same_request_id",
                "message": "Timed out",
            },
        )
        with self.assertRaisesRegex(ValueError, "new request id or never"):
            state.apply_status(payload)

    def test_active_run_blocks_revision_submission_without_losing_run_identity(self) -> None:
        state = ReplanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        acknowledge_revision(state)
        state.begin(target_instance_id=str(uuid.uuid4()))
        for phase in ("queued", "generating"):
            state.phase = phase
            before = deepcopy(state.__dict__)
            with self.assertRaisesRegex(ValueError, "active provider run"):
                state.ensure_revision_submission_allowed()
            self.assertEqual(state.__dict__, before)
            with self.assertRaisesRegex(ValueError, "active provider run"):
                state.revision_submitted(str(uuid.uuid4()))
            self.assertEqual(state.__dict__, before)
            self.assertFalse(state.invalidate_for_plan_install())
            self.assertEqual(state.__dict__, before)
            with self.assertRaisesRegex(ValueError, "refreshing providers"):
                state.ensure_provider_refresh_allowed()
            self.assertEqual(state.__dict__, before)
            state.revision_acknowledged(state.acknowledged_revision_request_id)
            self.assertEqual(state.__dict__, before)
            changed_providers = provider_list()
            changed_providers["providers"][0]["version"] = "0.2.0"
            with self.assertRaisesRegex(ValueError, "locked while a run"):
                state.set_providers(changed_providers)
            self.assertEqual(state.__dict__, before)
            self.assertFalse(
                state.complete_proposal_review(
                    state.acknowledged_revision_request_id,
                    str(uuid.uuid4()),
                )
            )
            self.assertEqual(state.__dict__, before)

        proposal_id = str(uuid.uuid4())
        state.apply_status(
            replan_run_status(
                state,
                "proposal_created",
                proposal_id=proposal_id,
            )
        )
        self.assertEqual(state.phase, "proposal_created")
        self.assertFalse(
            state.complete_proposal_review(
                state.acknowledged_revision_request_id,
                str(uuid.uuid4()),
            )
        )
        self.assertEqual(state.proposal_id, proposal_id)
        self.assertTrue(
            state.complete_proposal_review(
                state.acknowledged_revision_request_id,
                proposal_id,
            )
        )
        self.assertIsNone(state.proposal_id)
        state.ensure_revision_submission_allowed()

    def test_nonactive_plan_install_and_matching_external_review_clear_stale_request(self) -> None:
        state = ReplanRunState()
        self.assertFalse(state.invalidate_for_plan_install())
        self.assertEqual(state.phase, "idle")
        self.assertEqual(state.message, "")

        state.set_providers(provider_list())
        state.select("fake-planner")
        request_id = str(uuid.uuid4())
        state.revision_submitted(request_id)
        self.assertTrue(state.invalidate_for_plan_install())
        self.assertIsNone(state.pending_revision_request_id)
        self.assertFalse(state.can_run)

        state.revision_submitted(request_id)
        state.revision_acknowledged(request_id)
        acknowledged = deepcopy(state.__dict__)
        state.revision_acknowledged(request_id)
        self.assertEqual(state.__dict__, acknowledged)
        self.assertTrue(state.invalidate_for_plan_install())
        self.assertIsNone(state.acknowledged_revision_request_id)
        self.assertFalse(state.can_run)

        invalidated = deepcopy(state.__dict__)
        with self.assertRaisesRegex(ValueError, "unknown/stale request"):
            state.revision_acknowledged(request_id)
        self.assertEqual(state.__dict__, invalidated)

        acknowledge_revision(state, request_id)
        state.begin(target_instance_id=str(uuid.uuid4()))
        state.apply_status(
            replan_run_status(
                state,
                "failed",
                error={
                    "code": "planner_generation_conflict",
                    "retryMode": "new_request_id",
                    "message": "External proposal won the request race",
                },
            )
        )
        self.assertTrue(state.can_run)
        self.assertTrue(
            state.complete_proposal_review(request_id, str(uuid.uuid4()))
        )
        self.assertIsNone(state.acknowledged_revision_request_id)
        self.assertIsNone(state.generation_request_id)
        self.assertFalse(state.can_run)


class InitialPlanProviderHandoffTests(unittest.TestCase):
    def ready_state(self) -> InitialPlanRunState:
        state = InitialPlanRunState()
        state.set_providers(provider_list())
        state.select("fake-planner")
        state.goal_acknowledged(str(uuid.uuid4()))
        return state

    def test_discovery_never_selects_or_runs_a_provider(self) -> None:
        state = InitialPlanRunState()
        state.goal_acknowledged(str(uuid.uuid4()))

        state.set_providers(provider_list())

        self.assertIsNone(state.selected_provider_id)
        self.assertFalse(state.can_run)
        self.assertIsNone(state.generation_request_id)

    def test_authorization_is_bound_to_goal_provider_and_instance(self) -> None:
        state = self.ready_state()
        instance_id = str(uuid.uuid4())

        request = state.begin(target_instance_id=instance_id)

        self.assertEqual(request["goalRequestId"], state.acknowledged_goal_request_id)
        self.assertEqual(request["providerId"], "fake-planner")
        self.assertEqual(request["providerVersion"], "0.1.0")
        self.assertEqual(request["targetInstanceId"], instance_id)
        self.assertEqual(request["authorization"]["dataHandlingAcknowledged"], True)
        self.assertEqual(request["authorization"]["possibleChargesAcknowledged"], True)
        self.assertEqual(state.phase, "queued")

    def test_status_rejects_goal_provider_instance_and_scene_drift(self) -> None:
        mutations = (
            ("goalRequestId", str(uuid.uuid4()), "different goal request"),
            ("targetInstanceId", str(uuid.uuid4()), "different Blender instance"),
            ("sceneChanged", True, "scene-change safety"),
        )
        for field, value, message in mutations:
            state = self.ready_state()
            state.begin(target_instance_id=str(uuid.uuid4()))
            payload = initial_plan_run_status(state, "generating")
            payload[field] = value
            with self.assertRaisesRegex(ValueError, message):
                state.apply_status(payload)
        state = self.ready_state()
        state.begin(target_instance_id=str(uuid.uuid4()))
        payload = initial_plan_run_status(state, "generating")
        payload["provider"]["version"] = "0.2.0"
        with self.assertRaisesRegex(ValueError, "different provider"):
            state.apply_status(payload)

    def test_needs_revision_accepts_planning_only_and_requires_an_error(self) -> None:
        state = self.ready_state()
        state.begin(target_instance_id=str(uuid.uuid4()))
        finding = {
            "code": "missing_required_phase",
            "severity": "error",
            "message": "Add a supported modeling phase",
            "stepIds": [],
            "phaseIds": [],
        }
        state.apply_status(
            initial_plan_run_status(
                state,
                "needs_revision",
                needs_revision={
                    "planning": {
                        "errorCount": 1,
                        "warningCount": 0,
                        "findings": [finding],
                    }
                },
            )
        )
        self.assertEqual(state.phase, "needs_revision")
        self.assertEqual(state.needs_revision_summary, "1 planning errors, 0 warnings")
        self.assertTrue(state.can_run)

        invalid = self.ready_state()
        invalid.begin(target_instance_id=str(uuid.uuid4()))
        payload = initial_plan_run_status(
            invalid,
            "needs_revision",
            needs_revision={
                "planning": {"errorCount": 0, "warningCount": 0, "findings": []}
            },
        )
        with self.assertRaisesRegex(ValueError, "must contain an error"):
            invalid.apply_status(payload)

    def test_proposal_created_requires_exact_review_identity(self) -> None:
        state = self.ready_state()
        state.begin(target_instance_id=str(uuid.uuid4()))
        proposal_id = str(uuid.uuid4())
        state.apply_status(
            initial_plan_run_status(
                state, "proposal_created", proposal_id=proposal_id
            )
        )

        self.assertFalse(
            state.complete_proposal_review(
                state.acknowledged_goal_request_id, str(uuid.uuid4())
            )
        )
        self.assertEqual(state.proposal_id, proposal_id)
        self.assertTrue(
            state.complete_proposal_review(
                state.acknowledged_goal_request_id, proposal_id
            )
        )
        self.assertEqual(state.phase, "idle")

    def test_changed_provider_descriptor_requires_a_new_explicit_run(self) -> None:
        state = self.ready_state()
        request = state.begin(target_instance_id=str(uuid.uuid4()))
        state.reject_authorization(
            request["generationRequestId"], "Selected provider version is stale"
        )
        self.assertEqual(state.retry_mode, "never")
        self.assertFalse(state.can_run)

        refreshed = provider_list()
        refreshed["providers"][0]["version"] = "0.2.0"
        state.set_providers(refreshed)
        self.assertIsNone(state.selected_provider_id)
        state.select("fake-planner")

        self.assertEqual(state.phase, "idle")
        self.assertIsNone(state.retry_mode)
        self.assertTrue(state.can_run)


class RevisionContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.steps = tuple(
            action_node(f"step-{index}", f"1.{index + 1}", index)
            for index in range(6)
        )

    def test_session_indexes_stable_nodes_and_isolates_source_plan_copies(self) -> None:
        root = TaskNode(
            id="root",
            number="1",
            title="Root",
            order=0,
            children=(self.steps[0],),
        )
        source_plan = {
            "id": "revision-base",
            "revision": 7,
            "steps": [{"id": "root"}, {"id": self.steps[0].id}],
        }
        session = DemoSession(
            root,
            {},
            plan_id="revision-base",
            revision=7,
            source_plan=source_plan,
        )

        self.assertIs(session.find_node(self.steps[0].id), self.steps[0])
        first_copy = session.source_plan_copy()
        first_copy["revision"] = 99
        self.assertEqual(session.source_plan_copy()["revision"], 7)
        with self.assertRaisesRegex(ValueError, "identity"):
            DemoSession(
                root,
                {},
                plan_id="revision-base",
                revision=8,
                source_plan=source_plan,
            )

    def test_revision_lineage_advances_without_reusing_request_identity(self) -> None:
        first_request_id = str(uuid.uuid4())
        first_thread = new_revision_thread(first_request_id, None)
        self.assertEqual(
            first_thread,
            {
                "threadId": first_request_id,
                "turn": 1,
                "parentRequestId": None,
            },
        )
        lineage = lineage_from_proposal(
            {
                "revisionRequestId": first_request_id,
                "revisionThread": first_thread,
            }
        )
        self.assertEqual(
            lineage,
            RevisionLineage(first_request_id, 1, first_request_id),
        )
        second_request_id = str(uuid.uuid4())
        self.assertEqual(
            new_revision_thread(second_request_id, lineage),
            {
                "threadId": first_request_id,
                "turn": 2,
                "parentRequestId": first_request_id,
            },
        )

    def test_plan_diff_validation_preserves_exact_parameter_values(self) -> None:
        plan = {"id": "snowman", "revision": 2}
        diff = {
            "basePlan": {"id": "snowman", "revision": 1},
            "targetPlan": plan,
            "summary": {
                "planFields": 0,
                "addedSteps": 0,
                "removedSteps": 0,
                "updatedSteps": 1,
                "movedSteps": 0,
            },
            "planChanges": [],
            "stepChanges": [
                {
                    "kind": "updated",
                    "stepId": "snowman.model.head",
                    "before": {
                        "stepId": "snowman.model.head",
                        "nodeNumber": "1.2.3",
                        "parentId": "snowman.model",
                        "order": 3,
                        "title": "Create the head",
                    },
                    "after": {
                        "stepId": "snowman.model.head",
                        "nodeNumber": "1.2.3",
                        "parentId": "snowman.model",
                        "order": 3,
                        "title": "Create the larger head",
                    },
                    "changes": [
                        {
                            "field": "action",
                            "before": {"arguments": {"radius": 0.85}},
                            "after": {"arguments": {"radius": 0.93}},
                        }
                    ],
                }
            ],
        }
        validated = validate_plan_diff(diff, plan)
        self.assertEqual(
            validated["stepChanges"][0]["changes"][0]["after"]["arguments"][
                "radius"
            ],
            0.93,
        )
        invalid = {**diff, "summary": {**diff["summary"], "updatedSteps": 0}}
        with self.assertRaisesRegex(ValueError, "summary is inconsistent"):
            validate_plan_diff(invalid, plan)

    def test_revision_history_validation_keeps_exact_messages_and_decisions(self) -> None:
        thread_id = str(uuid.uuid4())
        instance_id = str(uuid.uuid4())
        proposal_id = str(uuid.uuid4())
        plan = {"id": "snowman", "revision": 2}
        request = {
            "protocolVersion": "1.1.0",
            "requestId": thread_id,
            "adapterId": "blender",
            "catalogVersion": "1.1.0",
            "instanceId": instance_id,
            "basePlan": {"id": "snowman", "revision": 1},
            "references": [{"nodeId": "head", "nodeNumber": "1.2"}],
            "message": "@1.2 Make the head larger",
            "revisionThread": {
                "threadId": thread_id,
                "turn": 1,
                "parentRequestId": None,
            },
            "occurredAt": "2026-08-05T10:00:00Z",
        }
        proposal = {
            "protocolVersion": "1.1.0",
            "proposalId": proposal_id,
            "targetAdapterId": "blender",
            "targetInstanceId": instance_id,
            "plan": plan,
            "revisionRequestId": thread_id,
            "revisionThread": request["revisionThread"],
            "planDiff": {
                "basePlan": {"id": "snowman", "revision": 1},
                "targetPlan": plan,
                "summary": {
                    "planFields": 0,
                    "addedSteps": 0,
                    "removedSteps": 0,
                    "updatedSteps": 0,
                    "movedSteps": 0,
                },
                "planChanges": [],
                "stepChanges": [],
            },
            "catalogVersion": "1.1.0",
            "proposedAt": "2026-08-05T10:01:00Z",
        }
        decision = {
            "protocolVersion": "1.1.0",
            "decisionId": str(uuid.uuid4()),
            "proposalId": proposal_id,
            "adapterId": "blender",
            "instanceId": instance_id,
            "decision": "accepted",
            "occurredAt": "2026-08-05T10:02:00Z",
        }
        history = {
            "protocolVersion": "1.1.0",
            "threadId": thread_id,
            "targetAdapterId": "blender",
            "instanceId": instance_id,
            "planId": "snowman",
            "latestTurn": 1,
            "status": "accepted",
            "turns": [
                {
                    "turn": 1,
                    "state": "accepted",
                    "request": request,
                    "proposal": proposal,
                    "decision": decision,
                }
            ],
            "page": {
                "beforeTurn": None,
                "nextBeforeTurn": None,
                "hasMore": False,
            },
        }
        validated = validate_revision_thread_history(
            history,
            instance_id=instance_id,
        )
        self.assertEqual(validated["turns"][0]["request"]["message"], request["message"])
        history["turns"][0]["decision"]["instanceId"] = str(uuid.uuid4())
        with self.assertRaisesRegex(ValueError, "outside its proposal scope"):
            validate_revision_thread_history(history, instance_id=instance_id)

        history["turns"][0]["decision"]["instanceId"] = instance_id
        second_request_id = str(uuid.uuid4())
        second_request = {
            **deepcopy(request),
            "requestId": second_request_id,
            "basePlan": plan,
            "message": "@1.2 Make the head rougher",
            "revisionThread": {
                "threadId": thread_id,
                "turn": 2,
                "parentRequestId": request["requestId"],
            },
            "occurredAt": "2026-08-05T10:03:00Z",
        }
        second_plan = {"id": "snowman", "revision": 3}
        second_proposal = {
            **deepcopy(proposal),
            "proposalId": str(uuid.uuid4()),
            "plan": second_plan,
            "revisionRequestId": second_request_id,
            "revisionThread": second_request["revisionThread"],
            "planDiff": {
                **deepcopy(proposal["planDiff"]),
                "basePlan": plan,
                "targetPlan": second_plan,
            },
            "proposedAt": "2026-08-05T10:04:00Z",
        }
        history["latestTurn"] = 2
        history["status"] = "awaiting_decision"
        history["turns"].append(
            {
                "turn": 2,
                "state": "awaiting_decision",
                "request": second_request,
                "proposal": second_proposal,
                "decision": None,
            }
        )
        validate_revision_thread_history(history, instance_id=instance_id)

        broken_request_chain = deepcopy(history)
        broken_request_chain["turns"][1]["request"]["revisionThread"][
            "parentRequestId"
        ] = str(uuid.uuid4())
        broken_request_chain["turns"][1]["proposal"]["revisionThread"] = (
            broken_request_chain["turns"][1]["request"]["revisionThread"]
        )
        with self.assertRaisesRegex(ValueError, "parent request chain"):
            validate_revision_thread_history(
                broken_request_chain,
                instance_id=instance_id,
            )

        broken_proposal_chain = deepcopy(history)
        proposal_thread = broken_proposal_chain["turns"][1]["proposal"][
            "revisionThread"
        ]
        broken_proposal_chain["turns"][1]["proposal"]["revisionThread"] = {
            **proposal_thread,
            "parentRequestId": str(uuid.uuid4()),
        }
        with self.assertRaisesRegex(ValueError, "wrong thread turn"):
            validate_revision_thread_history(
                broken_proposal_chain,
                instance_id=instance_id,
            )


if __name__ == "__main__":
    unittest.main()
