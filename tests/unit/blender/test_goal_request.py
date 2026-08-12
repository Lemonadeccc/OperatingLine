"""Focused pure-Python coverage for Blender's initial goal request."""

from importlib import import_module
from queue import Empty
from pathlib import Path
from types import ModuleType
import sys
import time
import unittest
from urllib.error import HTTPError
import uuid


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_goal_request_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line

domain = import_module(f"{PACKAGE_NAME}.domain")
goal_request_module = import_module(f"{PACKAGE_NAME}.application.goal_request")

# Import the Blender-free transport without executing infrastructure/__init__.py,
# whose public facade intentionally includes bpy-backed implementations.
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
transport_module = import_module(
    f"{PACKAGE_NAME}.infrastructure.companion_transport"
)

GoalRequestState = goal_request_module.GoalRequestState
build_goal_request = goal_request_module.build_goal_request
CompanionTransport = transport_module.CompanionTransport


class GoalRequestPayloadTests(unittest.TestCase):
    def test_payload_is_trimmed_stable_and_host_specific(self) -> None:
        instance_id = str(uuid.uuid4())
        payload = build_goal_request(instance_id, "  Build a small robot  ")

        self.assertEqual(
            set(payload),
            {
                "protocolVersion",
                "requestId",
                "adapterId",
                "catalogVersion",
                "instanceId",
                "goal",
                "planId",
                "occurredAt",
            },
        )
        self.assertEqual(payload["protocolVersion"], "1.5.0")
        self.assertEqual(payload["adapterId"], "blender")
        self.assertEqual(
            payload["catalogVersion"], domain.BLENDER_ACTION_CATALOG_VERSION
        )
        self.assertEqual(payload["instanceId"], instance_id)
        self.assertEqual(payload["goal"], "Build a small robot")
        uuid.UUID(payload["requestId"])
        self.assertEqual(payload["planId"], f"goal-{payload['requestId']}")
        self.assertLessEqual(len(payload["planId"]), 180)
        self.assertTrue(payload["occurredAt"].endswith("Z"))

    def test_state_retains_exact_payload_and_prevents_parallel_submission(self) -> None:
        state = GoalRequestState()
        payload = build_goal_request(str(uuid.uuid4()), "Build a robot")
        state.submit(payload)
        returned = state.payload
        assert returned is not None
        returned["goal"] = "mutated"

        self.assertEqual(state.payload, payload)
        self.assertEqual(state.goal_summary, "Build a robot")
        with self.assertRaisesRegex(ValueError, "already active"):
            state.submit(build_goal_request(str(uuid.uuid4()), "Another goal"))
        state.acknowledged(payload["requestId"])
        self.assertEqual(state.phase, "awaiting_planner")
        state.delivery_error("unrelated guide poll failed")
        self.assertEqual(state.phase, "awaiting_planner")
        self.assertFalse(state.delivery_rejected(str(uuid.uuid4()), "conflict"))
        self.assertEqual(state.phase, "awaiting_planner")
        self.assertTrue(state.delivery_rejected(payload["requestId"], "conflict"))
        self.assertEqual(state.phase, "error")
        self.assertIn("conflict", state.message)
        state.acknowledged(payload["requestId"])
        state.proposal_received()
        self.assertEqual(state.phase, "proposal_received")
        state.clear()
        self.assertEqual(state.goal_summary, "")

    def test_goal_summary_is_bounded_for_the_sidebar(self) -> None:
        state = GoalRequestState()
        state.submit(build_goal_request(str(uuid.uuid4()), "x" * 200))

        self.assertEqual(len(state.goal_summary), 160)
        self.assertTrue(state.goal_summary.endswith("..."))


class GoalRequestTransportTests(unittest.TestCase):
    def test_dialogue_run_uses_explicit_discovery_and_durable_short_polling(self) -> None:
        instance_id = str(uuid.uuid4())
        dialogue_id = str(uuid.uuid4())
        request = {
            "dialogueRequestId": dialogue_id,
            "replanGenerationRequestId": str(uuid.uuid4()),
            "providerId": "fake-planner",
            "providerVersion": "0.1.0",
            "targetAdapterId": "blender",
            "targetInstanceId": instance_id,
            "revisionRequest": {"requestId": str(uuid.uuid4())},
            "history": [],
            "authorization": {"authorizedProviderCallLimit": 2},
        }
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            poll_interval=0.01,
            timeout=0.1,
        )
        calls = []
        polls = [0]

        def run_status(status):
            return {
                "dialogueRequestId": dialogue_id,
                "status": status,
                "terminal": status == "answered",
            }

        def request_json(method, path, body=None, **_kwargs):
            calls.append((method, path, body))
            if path == "/api/v1/replan/providers":
                return {
                    "contractVersion": "1.0.0",
                    "generationAvailable": False,
                    "providers": [],
                }
            if path == "/api/v1/dialogue/providers":
                return {
                    "contractVersion": "1.0.0",
                    "generationAvailable": False,
                    "providers": [],
                }
            if path == "/api/v1/companion/dialogue-run":
                self.assertEqual(body, request)
                return run_status("queued")
            if path.startswith("/api/v1/companion/dialogue-run?"):
                self.assertIn(f"dialogueRequestId={dialogue_id}", path)
                polls[0] += 1
                return run_status("streaming" if polls[0] == 1 else "answered")
            raise AssertionError(f"Unexpected request: {method} {path}")

        transport._request_json = request_json
        transport._poll = lambda: None
        transport.start()
        time.sleep(0.05)
        self.assertFalse(
            any(path == "/api/v1/dialogue/providers" for _, path, _ in calls),
            "dialogue provider discovery must wait for an explicit refresh",
        )
        transport.refresh_dialogue_providers()
        transport.start_dialogue_run(request)
        messages = []
        deadline = time.monotonic() + 2.0
        try:
            while time.monotonic() < deadline:
                try:
                    message = transport.incoming.get(timeout=0.05)
                except Empty:
                    continue
                messages.append(message)
                if (
                    message.get("kind") == "dialogue_run_status"
                    and message["run"].get("status") == "answered"
                ):
                    break
        finally:
            transport.stop(flush_timeout=0.0)
            transport.wait_stopped(1.0)

        self.assertTrue(
            any(item.get("kind") == "dialogue_provider_list" for item in messages)
        )
        statuses = [
            item["run"]["status"]
            for item in messages
            if item.get("kind") == "dialogue_run_status"
        ]
        self.assertEqual(statuses, ["queued", "streaming", "answered"])

    def test_initial_plan_provider_run_is_explicit_and_polls_exact_run(self) -> None:
        instance_id = str(uuid.uuid4())
        generation_id = str(uuid.uuid4())
        goal_id = str(uuid.uuid4())
        proposal_id = str(uuid.uuid4())
        request = {
            "generationRequestId": generation_id,
            "goalRequestId": goal_id,
            "providerId": "fake-planner",
            "providerVersion": "0.1.0",
            "targetAdapterId": "blender",
            "targetInstanceId": instance_id,
            "authorization": {},
        }
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            poll_interval=0.01,
            timeout=0.1,
        )
        calls = []

        def run_status(status, proposal=None):
            return {
                "generationRequestId": generation_id,
                "status": status,
                "terminal": status == "proposal_created",
                "proposalId": proposal,
            }

        def request_json(method, path, body=None, **_kwargs):
            calls.append((method, path, body))
            if path == "/api/v1/replan/providers":
                return {
                    "contractVersion": "1.0.0",
                    "generationAvailable": False,
                    "providers": [],
                }
            if path == "/api/v1/planner/providers":
                return {
                    "contractVersion": "1.0.0",
                    "generationAvailable": False,
                    "providers": [],
                }
            if path == "/api/v1/companion/initial-plan-run":
                self.assertEqual(body, request)
                return run_status("queued")
            if path.startswith("/api/v1/companion/initial-plan-run?"):
                self.assertIn(f"generationRequestId={generation_id}", path)
                return run_status("proposal_created", proposal_id)
            raise AssertionError(f"Unexpected request: {method} {path}")

        transport._request_json = request_json
        transport._poll = lambda: None
        transport.start()
        time.sleep(0.05)
        self.assertFalse(
            any(path == "/api/v1/planner/providers" for _, path, _ in calls),
            "initial provider discovery must wait for an explicit refresh",
        )
        transport.refresh_initial_plan_providers()
        transport.start_initial_plan_run(request)
        messages = []
        deadline = time.monotonic() + 2.0
        try:
            while time.monotonic() < deadline:
                try:
                    message = transport.incoming.get(timeout=0.05)
                except Empty:
                    continue
                messages.append(message)
                if (
                    message.get("kind") == "initial_plan_run_status"
                    and message["run"].get("status") == "proposal_created"
                ):
                    break
        finally:
            transport.stop(flush_timeout=0.0)
            transport.wait_stopped(1.0)

        self.assertTrue(
            any(item.get("kind") == "initial_plan_provider_list" for item in messages)
        )
        statuses = [
            item["run"]["status"]
            for item in messages
            if item.get("kind") == "initial_plan_run_status"
        ]
        self.assertEqual(statuses, ["queued", "proposal_created"])

    def test_background_queue_retries_same_payload_and_accepts_duplicate_ack(self) -> None:
        instance_id = str(uuid.uuid4())
        payload = build_goal_request(instance_id, "Build a robot")
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            poll_interval=0.01,
            timeout=0.1,
        )
        goal_attempts = []

        def request_json(method, path, body=None, **_kwargs):
            if path == "/api/v1/replan/providers":
                return {
                    "contractVersion": "1.0.0",
                    "generationAvailable": False,
                    "providers": [],
                }
            if path == "/api/v1/companion/goal-request":
                goal_attempts.append(body)
                if len(goal_attempts) == 1:
                    raise OSError("temporary outage")
                return {"requestId": body["requestId"], "result": "duplicate"}
            raise AssertionError(f"Unexpected request: {method} {path}")

        transport._request_json = request_json
        transport._poll = lambda: None
        started = time.monotonic()
        transport.start()
        transport.submit_goal_request(payload)
        self.assertLess(time.monotonic() - started, 0.1)

        messages = []
        deadline = time.monotonic() + 2.0
        try:
            while time.monotonic() < deadline:
                try:
                    message = transport.incoming.get(timeout=0.05)
                except Empty:
                    continue
                messages.append(message)
                if message.get("kind") == "goal_request_acknowledged":
                    break
        finally:
            transport.stop(flush_timeout=0.0)
            transport.wait_stopped(1.0)

        self.assertTrue(any(item.get("kind") == "error" for item in messages))
        self.assertTrue(
            any(item.get("kind") == "goal_request_delivering" for item in messages)
        )
        self.assertEqual(messages[-1]["kind"], "goal_request_acknowledged")
        self.assertEqual(messages[-1]["requestId"], payload["requestId"])
        self.assertEqual(goal_attempts, [payload, payload])

    def test_lost_decision_response_retries_exact_decision_until_main_thread_ack(self) -> None:
        instance_id = str(uuid.uuid4())
        decision = {
            "protocolVersion": "1.2.0",
            "decisionId": str(uuid.uuid4()),
            "proposalId": str(uuid.uuid4()),
            "adapterId": "blender",
            "instanceId": instance_id,
            "decision": "accepted",
            "occurredAt": "2026-08-09T12:00:00Z",
        }
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            poll_interval=0.01,
            timeout=0.1,
        )
        attempts = []
        polls = []

        def request_json(method, path, body=None, **_kwargs):
            if path == "/api/v1/replan/providers":
                return {
                    "contractVersion": "1.0.0",
                    "generationAvailable": False,
                    "providers": [],
                }
            if path == "/api/v1/companion/proposal-decision":
                attempts.append(dict(body))
                if len(attempts) == 1:
                    raise OSError("response lost after commit")
                return {"result": "duplicate"}
            raise AssertionError(f"Unexpected request: {method} {path}")

        transport._request_json = request_json
        transport._poll = lambda: polls.append(time.monotonic())
        transport.start()
        transport.submit_proposal_decision(decision)
        acknowledged = None
        deadline = time.monotonic() + 2.0
        try:
            while time.monotonic() < deadline and acknowledged is None:
                try:
                    message = transport.incoming.get(timeout=0.05)
                except Empty:
                    continue
                if message.get("kind") == "proposal_decision_acknowledged":
                    acknowledged = message
        finally:
            transport.stop(flush_timeout=0.0)
            transport.wait_stopped(1.0)

        self.assertIsNotNone(acknowledged)
        self.assertEqual(acknowledged["decision"], decision)
        self.assertEqual(attempts, [decision, decision])
        self.assertTrue(polls, "decision retry must not starve guide polling")

    def test_permanent_goal_rejection_is_terminal_but_polling_continues(self) -> None:
        instance_id = str(uuid.uuid4())
        payload = build_goal_request(instance_id, "Build a robot")
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            poll_interval=0.01,
            timeout=0.1,
        )
        attempts = []
        polls = []

        def request_json(method, path, body=None, **_kwargs):
            if path == "/api/v1/replan/providers":
                return {
                    "contractVersion": "1.0.0",
                    "generationAvailable": False,
                    "providers": [],
                }
            if path == "/api/v1/companion/goal-request":
                attempts.append(dict(body))
                error = HTTPError(path, 409, "Conflict", {}, None)
                error.runtime_payload = {
                    "message": "This request id belongs to another goal"
                }
                raise error
            raise AssertionError(f"Unexpected request: {method} {path}")

        transport._request_json = request_json
        transport._poll = lambda: polls.append(time.monotonic())
        transport.start()
        transport.submit_goal_request(payload)
        rejected = None
        deadline = time.monotonic() + 2.0
        try:
            while time.monotonic() < deadline and rejected is None:
                try:
                    message = transport.incoming.get(timeout=0.05)
                except Empty:
                    continue
                if message.get("kind") == "goal_request_rejected":
                    rejected = message
            poll_deadline = time.monotonic() + 0.2
            while time.monotonic() < poll_deadline and not polls:
                time.sleep(0.01)
        finally:
            transport.stop(flush_timeout=0.0)
            transport.wait_stopped(1.0)

        self.assertEqual(len(attempts), 1)
        self.assertEqual(rejected["requestId"], payload["requestId"])
        self.assertIn("another goal", rejected["message"])
        self.assertTrue(polls, "terminal goal delivery must not stop guide polling")


if __name__ == "__main__":
    unittest.main()
