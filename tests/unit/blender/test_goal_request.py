"""Focused pure-Python coverage for Blender's initial goal request."""

from copy import deepcopy
from importlib import import_module
from queue import Empty
from pathlib import Path
from types import ModuleType
import sys
import threading
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
    @staticmethod
    def _action_delivery(instance_id: str) -> dict:
        return {
            "formatVersion": "1.0.0",
            "requestId": str(uuid.uuid4()),
            "replayId": str(uuid.uuid4()),
            "deliveryId": str(uuid.uuid4()),
            "target": {"adapterId": "blender", "instanceId": instance_id},
            "proposalId": str(uuid.uuid4()),
            "plan": {"id": "uv-sphere-plan", "revision": 1},
            "planContentSha256": "a" * 64,
            "executionId": str(uuid.uuid4()),
            "expectedState": {"reportId": str(uuid.uuid4()), "sequence": 2},
            "step": {
                "id": "uv-sphere.create",
                "parentId": "root",
                "order": 1,
                "dependsOn": [],
                "title": "Create sphere",
                "intent": "Create a UV Sphere",
                "explanation": "Create exactly one reviewed sphere.",
                "state": "ready",
                "action": {
                    "adapterId": "blender",
                    "name": "blender.mesh.create_uv_sphere",
                    "arguments": {
                        "resourceId": "uv-sphere",
                        "objectName": "OperatingLine.ActionSphere",
                        "radius": 1.0,
                        "location": [0.0, 0.0, 0.0],
                    },
                },
                "anchors": [],
                "expectedObservations": [
                    {
                        "kind": "resource_exists",
                        "parameters": {"resourceId": "uv-sphere"},
                    }
                ],
                "observationPolicy": {
                    "mode": "success_gate",
                    "failureStrategy": "rollback_step",
                },
                "rollback": {
                    "mode": "compensating_action",
                    "checkpointRequired": False,
                },
            },
            "requestedAt": "2026-08-20T12:00:00Z",
            "dispatchedAt": "2026-08-20T12:00:01Z",
        }

    def _session_response(self, path, body):
        if path == "/api/v1/companion/session":
            self.assertEqual(body["contractVersion"], "1.0.0")
            self.assertEqual(body["adapterId"], "blender")
            self.assertEqual(
                body["catalogVersion"], domain.BLENDER_ACTION_CATALOG_VERSION
            )
            self.assertEqual(
                body["supportedGuideProtocolVersions"],
                sorted(domain.SUPPORTED_PROTOCOL_VERSIONS),
            )
            return {
                "contractVersion": "1.0.0",
                "leaseId": str(uuid.uuid4()),
                "negotiatedGuideProtocolVersion": domain.PROTOCOL_VERSION,
                "catalogVersion": body["catalogVersion"],
                "capabilities": body["capabilities"],
                "heartbeatIntervalMs": 60_000,
                "leaseTtlMs": 120_000,
                "expiresAt": "2099-01-01T00:00:00Z",
            }
        if path == "/api/v1/companion/heartbeat":
            return {
                "contractVersion": "1.0.0",
                "leaseId": body["leaseId"],
                "sequence": body["sequence"],
                "expiresAt": "2099-01-01T00:00:00Z",
            }
        return None

    def test_session_and_heartbeat_publish_atomic_immutable_snapshots(self) -> None:
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            str(uuid.uuid4()),
        )
        heartbeat_observations = []

        def request_json(_method, path, body=None, **_kwargs):
            if path == "/api/v1/companion/session":
                self.assertEqual(
                    body["capabilities"]["execution"]["rollbackModes"],
                    ["compensating_action", "native_undo"],
                )
                response = self._session_response(path, body)
                # Server timestamps are descriptive wall-clock values and may
                # appear old to a client whose clock is ahead.
                response["expiresAt"] = "2000-01-01T00:00:00Z"
                return response
            if path == "/api/v1/companion/heartbeat":
                current = transport.session_snapshot
                heartbeat_observations.append(
                    (current.heartbeat_sequence, current.expires_at)
                )
                return {
                    "contractVersion": "1.0.0",
                    "leaseId": body["leaseId"],
                    "sequence": body["sequence"],
                    "expiresAt": "2000-01-01T00:00:01+00:00",
                }
            raise AssertionError(f"Unexpected request: {path}")

        transport._request_json = request_json
        transport._establish_session()
        established = transport.session_snapshot
        self.assertIsNotNone(established)
        self.assertEqual(established.heartbeat_sequence, 0)

        transport._send_heartbeat()
        renewed = transport.session_snapshot
        self.assertIsNot(established, renewed)
        self.assertEqual(heartbeat_observations, [(0, "2000-01-01T00:00:00Z")])
        self.assertEqual(established.heartbeat_sequence, 0)
        self.assertEqual(renewed.heartbeat_sequence, 1)
        self.assertEqual(renewed.expires_at, "2000-01-01T00:00:01+00:00")

        transport._clear_session()
        self.assertIsNone(transport.session_snapshot)
        self.assertEqual(established.heartbeat_sequence, 0)

    def test_poll_delivers_each_replay_current_state_request_once(self) -> None:
        instance_id = str(uuid.uuid4())
        request = {
            "formatVersion": "1.0.0",
            "verificationId": str(uuid.uuid4()),
            "replayId": str(uuid.uuid4()),
            "attestationId": str(uuid.uuid4()),
            "attestationContentSha256": "a" * 64,
            "target": {"adapterId": "blender", "instanceId": instance_id},
            "plan": {"id": "snowman", "revision": 1},
            "planContentSha256": "b" * 64,
            "executionId": str(uuid.uuid4()),
            "stepId": "snowman.eye.left",
            "expectedObservation": {
                "kind": "uv_sphere_ready",
                "contentSha256": "c" * 64,
            },
            "requestedAt": "2026-08-18T12:00:00Z",
        }
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
        )

        def request_json(_method, path, body=None, **_kwargs):
            session_response = self._session_response(path, body)
            if session_response is not None:
                return session_response
            if path.startswith("/api/v1/companion/guide?"):
                return {
                    "protocolVersion": transport.session_snapshot.negotiated_guide_protocol_version,
                    "plan": None,
                    "planContentSha256": None,
                    "proposal": None,
                    "proposalPlanContentSha256": None,
                    "procedureReplayCurrentStateRequest": request,
                }
            if path.startswith("/api/v1/companion/action?"):
                return {"request": None}
            raise AssertionError(f"Unexpected request: {path}")

        transport._request_json = request_json
        transport._establish_session()
        transport._poll()
        transport._poll()

        self.assertEqual(transport.incoming.get_nowait()["kind"], "session_established")
        self.assertEqual(
            transport.incoming.get_nowait(),
            {"kind": "procedure_replay_current_state_request", "request": request},
        )
        with self.assertRaises(Empty):
            transport.incoming.get_nowait()

    def test_action_poll_strictly_validates_and_deduplicates_requests(self) -> None:
        instance_id = str(uuid.uuid4())
        delivery = self._action_delivery(instance_id)
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
        )
        transport._request_json = lambda *_args, **_kwargs: {"request": delivery}

        transport._poll_action_request()
        transport._poll_action_request()

        self.assertEqual(
            transport.incoming.get_nowait(),
            {"kind": "action_execute_request", "request": delivery},
        )
        with self.assertRaises(Empty):
            transport.incoming.get_nowait()

        for mutation, message in (
            (("extra", True), "invalid fields"),
            (("requestId", "not-a-uuid"), "must be a UUID"),
            (("planContentSha256", "A" * 64), "SHA-256 is invalid"),
        ):
            invalid = deepcopy(delivery)
            invalid[mutation[0]] = mutation[1]
            invalid["requestId"] = (
                invalid["requestId"]
                if mutation[0] == "requestId"
                else str(uuid.uuid4())
            )
            transport._request_json = (
                lambda *_args, candidate=invalid, **_kwargs: {"request": candidate}
            )
            with self.assertRaisesRegex(ValueError, message):
                transport._poll_action_request()

    def test_action_step_accepts_only_the_seven_approved_primitives(self) -> None:
        instance_id = str(uuid.uuid4())
        step = self._action_delivery(instance_id)["step"]

        for action_name in (
            "blender.mesh.create_uv_sphere",
            "blender.mesh.create_icosphere",
            "blender.mesh.create_cube",
            "blender.mesh.create_plane",
            "blender.mesh.create_torus",
            "blender.mesh.create_cone",
            "blender.mesh.create_cylinder",
        ):
            with self.subTest(action_name=action_name):
                candidate = deepcopy(step)
                candidate["action"]["name"] = action_name
                CompanionTransport._validate_action_step(candidate)

        for action_name in (
            "blender.mesh.create_primitive_batch",
            "blender.mesh.edit_subdivide",
            "blender.mesh.create_monkey",
        ):
            with self.subTest(action_name=action_name):
                candidate = deepcopy(step)
                candidate["action"]["name"] = action_name
                with self.assertRaisesRegex(ValueError, "approved primitives"):
                    CompanionTransport._validate_action_step(candidate)

    def test_action_result_waits_for_state_delivery_and_flushes_on_shutdown(self) -> None:
        instance_id = str(uuid.uuid4())
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            poll_interval=10.0,
        )
        delivery = self._action_delivery(instance_id)
        state_report = {
            "reportId": str(uuid.uuid4()),
            "sequence": 3,
        }
        result = {
            key: deepcopy(delivery[key])
            for key in (
                "formatVersion",
                "requestId",
                "replayId",
                "deliveryId",
                "target",
                "proposalId",
                "plan",
                "planContentSha256",
                "executionId",
                "expectedState",
            )
        }
        result.update(
            {
                "stepId": delivery["step"]["id"],
                "status": "succeeded",
                "report": state_report,
                "error": None,
                "occurredAt": "2026-08-20T12:00:02Z",
            }
        )
        calls = []

        def request_json(_method, path, body=None, **_kwargs):
            if path == "/api/v1/companion/session":
                return self._session_response(path, body)
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            if path == "/api/v1/companion/state":
                calls.append((path, deepcopy(body)))
                return {"result": "accepted"}
            if path == "/api/v1/companion/action-result":
                calls.append((path, deepcopy(body)))
                return {"result": "accepted"}
            raise AssertionError(f"Unexpected request: {path}")

        transport._request_json = request_json
        transport._poll = lambda: None
        transport._poll_action_request = lambda: None
        transport._establish_session()
        transport.send_report(state_report)
        transport.submit_action_result(result)
        transport.start()
        transport.stop(flush_timeout=0.5)
        self.assertTrue(transport.wait_stopped(1.0))
        self.assertEqual(
            [path for path, _body in calls],
            ["/api/v1/companion/state", "/api/v1/companion/action-result"],
        )
        self.assertEqual(transport.last_delivered_sequence, 3)

    def test_action_result_http_4xx_is_permanent_and_not_retried(self) -> None:
        instance_id = str(uuid.uuid4())
        delivery = self._action_delivery(instance_id)
        result = {
            key: deepcopy(delivery[key])
            for key in (
                "formatVersion",
                "requestId",
                "replayId",
                "deliveryId",
                "target",
                "proposalId",
                "plan",
                "planContentSha256",
                "executionId",
                "expectedState",
            )
        }
        result.update(
            {
                "stepId": delivery["step"]["id"],
                "status": "rejected",
                "report": None,
                "error": "stale expected state",
                "occurredAt": "2026-08-20T12:00:02Z",
            }
        )
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            poll_interval=10.0,
        )
        attempts = []

        def request_json(_method, path, body=None, **_kwargs):
            if path == "/api/v1/companion/session":
                return self._session_response(path, body)
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            if path == "/api/v1/companion/action-result":
                attempts.append(deepcopy(body))
                raise HTTPError(path, 409, "Conflict", {}, None)
            raise AssertionError(f"Unexpected request: {path}")

        transport._request_json = request_json
        transport._poll = lambda: None
        transport.submit_action_result(result)
        transport.start()
        deadline = time.monotonic() + 1.0
        rejected = None
        while time.monotonic() < deadline:
            try:
                message = transport.incoming.get_nowait()
            except Empty:
                time.sleep(0.01)
                continue
            if message.get("kind") == "action_result_rejected":
                rejected = message
                break
        transport.stop(flush_timeout=0.5)
        self.assertTrue(transport.wait_stopped(1.0))
        self.assertEqual(attempts, [result])
        self.assertEqual(rejected["requestId"], result["requestId"])

    def test_unrelated_later_report_does_not_unlock_action_result(self) -> None:
        instance_id = str(uuid.uuid4())
        delivery = self._action_delivery(instance_id)
        referenced_report = {
            "reportId": str(uuid.uuid4()),
            "sequence": 3,
        }
        unrelated_report = {
            "reportId": str(uuid.uuid4()),
            "sequence": 4,
        }
        result = {
            key: deepcopy(delivery[key])
            for key in (
                "formatVersion",
                "requestId",
                "replayId",
                "deliveryId",
                "target",
                "proposalId",
                "plan",
                "planContentSha256",
                "executionId",
                "expectedState",
            )
        }
        result.update(
            {
                "stepId": delivery["step"]["id"],
                "status": "succeeded",
                "report": referenced_report,
                "error": None,
                "occurredAt": "2026-08-20T12:00:02Z",
            }
        )
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            poll_interval=10.0,
        )
        state_delivered = threading.Event()
        action_attempts = []

        def request_json(_method, path, body=None, **_kwargs):
            if path == "/api/v1/companion/session":
                return self._session_response(path, body)
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            if path == "/api/v1/companion/state":
                state_delivered.set()
                return {"result": "accepted"}
            if path == "/api/v1/companion/action-result":
                action_attempts.append(deepcopy(body))
                return {"result": "accepted"}
            raise AssertionError(f"Unexpected request: {path}")

        transport._request_json = request_json
        transport._poll = lambda: None
        transport._poll_action_request = lambda: None
        transport._establish_session()
        transport.send_report(unrelated_report)
        transport.submit_action_result(result)
        transport.start()
        self.assertTrue(state_delivered.wait(timeout=1.0))
        time.sleep(0.05)
        transport.stop(flush_timeout=0.05)
        self.assertTrue(transport.wait_stopped(1.0))
        self.assertEqual(action_attempts, [])
        self.assertEqual(transport.last_delivered_sequence, 4)

    def test_stop_flush_never_reestablishes_a_cleared_or_existing_session(self) -> None:
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            str(uuid.uuid4()),
            poll_interval=0.01,
        )
        session_requests = []
        state_started = threading.Event()
        release_state = threading.Event()

        def request_json(_method, path, body=None, **_kwargs):
            if path == "/api/v1/companion/session":
                session_requests.append(dict(body))
                return self._session_response(path, body)
            if path in {"/api/v1/replan/providers", "/api/v1/initial-plan/providers"}:
                return {
                    "contractVersion": "1.0.0",
                    "generationAvailable": False,
                    "providers": [],
                }
            if path == "/api/v1/companion/state":
                state_started.set()
                release_state.wait(timeout=1.0)
                return {"result": "accepted"}
            raise AssertionError(f"Unexpected request: {path}")

        transport._request_json = request_json
        transport._poll = lambda: None
        transport._establish_session()
        transport.send_report({"sequence": 1})
        transport.start()
        self.assertTrue(state_started.wait(timeout=1.0))
        transport.stop(flush_timeout=0.5)
        self.assertIsNotNone(transport.session_snapshot)
        release_state.set()
        self.assertTrue(transport.wait_stopped(1.0))
        self.assertEqual(len(session_requests), 1)
        self.assertIsNone(transport.session_snapshot)

    def test_failed_session_establishment_uses_bounded_backoff(self) -> None:
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            str(uuid.uuid4()),
            poll_interval=0.2,
        )
        attempts = []

        def request_json(_method, path, _body=None, **_kwargs):
            if path == "/api/v1/companion/session":
                attempts.append(time.monotonic())
                raise OSError("runtime unavailable")
            raise AssertionError(f"Unexpected request: {path}")

        transport._request_json = request_json
        transport.start()
        time.sleep(0.48)
        transport.stop(flush_timeout=0.0)
        self.assertTrue(transport.wait_stopped(1.0))
        self.assertGreaterEqual(len(attempts), 2)
        self.assertLessEqual(len(attempts), 3)
        self.assertTrue(
            all(
                later - earlier >= 0.17
                for earlier, later in zip(attempts, attempts[1:])
            )
        )

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
            session_response = self._session_response(path, body)
            if session_response is not None:
                return session_response
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
            session_response = self._session_response(path, body)
            if session_response is not None:
                return session_response
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
            session_response = self._session_response(path, body)
            if session_response is not None:
                return session_response
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
            session_response = self._session_response(path, body)
            if session_response is not None:
                return session_response
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
            session_response = self._session_response(path, body)
            if session_response is not None:
                return session_response
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
