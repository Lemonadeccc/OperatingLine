"""Pure-Python contracts for the independent leaf-operation transport."""

from copy import deepcopy
from datetime import datetime, timezone
from importlib import import_module
from pathlib import Path
from types import ModuleType
import sys
import time
import unittest
import uuid
from urllib.error import HTTPError
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_leaf_operation_transport_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line
domain = import_module(f"{PACKAGE_NAME}.domain")
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
transport_module = import_module(f"{PACKAGE_NAME}.infrastructure.companion_transport")


class LeafOperationCompanionTransportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.instance_id = str(uuid.uuid4())
        self.transport = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            self.instance_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
        )

    def _http_error(self, path: str, runtime_payload: dict) -> HTTPError:
        error = HTTPError(path, 409, "Conflict", {}, None)
        error.runtime_payload = runtime_payload
        self.addCleanup(error.close)
        return error

    def _delivery(self, ordinal: int = 1) -> dict:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        operation_ids = list(transport_module.TRANSFORM_GEOMETRY_LEAF_OPERATION_IDS)
        authority = {
            "formatVersion": "1.0.0",
            "requestId": str(uuid.uuid4()),
            "replayId": str(uuid.uuid4()),
            "target": {"adapterId": "blender", "instanceId": self.instance_id},
            "proposalId": str(uuid.uuid4()),
            "plan": {"id": "plan-1", "revision": 1},
            "planContentSha256": "1" * 64,
            "executionId": str(uuid.uuid4()),
            "leafId": "leaf.transform",
            "stepId": "leaf.transform",
            "actionName": transport_module.TRANSFORM_GEOMETRY_LEAF_OPERATION_ACTION,
            "recipeId": transport_module.TRANSFORM_GEOMETRY_LEAF_OPERATION_RECIPE,
            "catalogVersion": "1.49.0",
            "interactionCatalogContentSha256": "2" * 64,
            "materializationContentSha256": "3" * 64,
            "mcpTrackContentSha256": "4" * 64,
            "expectedState": {"reportId": str(uuid.uuid4()), "sequence": 7},
            "operationIds": operation_ids,
            "operationOrdinal": ordinal,
            "sourceOperationId": operation_ids[ordinal - 1],
            "operationParameters": {},
        }
        return {
            **authority,
            "operationBindingSha256": self.transport._canonical_sha256(authority),
            "deliveryId": str(uuid.uuid4()),
            "requestedAt": now,
            "dispatchedAt": now,
        }

    def _light_trails_delivery(self, ordinal: int = 1) -> dict:
        delivery = self._delivery()
        operation_ids = list(transport_module.LIGHT_TRAILS_LEAF_OPERATION_IDS)
        delivery.update(
            {
                "actionName": transport_module.LIGHT_TRAILS_LEAF_OPERATION_ACTION,
                "recipeId": transport_module.LIGHT_TRAILS_LEAF_OPERATION_RECIPE,
                "catalogVersion": "1.55.0",
                "leafId": "leaf.light-trails",
                "stepId": "leaf.light-trails",
                "operationIds": operation_ids,
                "operationOrdinal": ordinal,
                "sourceOperationId": operation_ids[ordinal - 1],
                "operationParameters": {},
            }
        )
        authority = {
            key: deepcopy(delivery[key])
            for key in transport_module.LEAF_OPERATION_AUTHORITY_KEYS
        }
        delivery["operationBindingSha256"] = self.transport._canonical_sha256(authority)
        return delivery

    def _recovery_challenge(self, *, native_guard=None) -> dict:
        delivery = self._delivery()
        return {
            "formatVersion": "1.0.0",
            "recoveryId": str(uuid.uuid4()),
            "originalDelivery": delivery,
            "originalSessionFingerprintSha256": "7" * 64,
            "replacementSessionFingerprintSha256": "8" * 64,
            "expectedState": deepcopy(delivery["expectedState"]),
            "acceptedPrefix": {
                "completedOperationIds": [],
                "runId": None,
                "bindingSha256": None,
                "receiptId": None,
                "nextOrdinal": 1,
                "latestFingerprintSha256": None,
            },
            "authorityProof": {
                "reportId": delivery["expectedState"]["reportId"],
                "sequence": delivery["expectedState"]["sequence"],
                "authorizedStartCheckpointId": str(uuid.uuid4()),
            },
            "nativeUndoGuard": native_guard,
            "mode": "read_only_reconcile",
            "automaticReplay": False,
            "requestedAt": delivery["dispatchedAt"],
        }

    def _recovery_ack(self) -> dict:
        challenge = self._recovery_challenge()
        observed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return {
            "formatVersion": "1.0.0",
            "challenge": challenge,
            "recoveryId": challenge["recoveryId"],
            "requestId": challenge["originalDelivery"]["requestId"],
            "originalDeliveryId": challenge["originalDelivery"]["deliveryId"],
            "replacementSessionFingerprintSha256": challenge[
                "replacementSessionFingerprintSha256"
            ],
            "outcome": "prefix_restored",
            "evidence": {
                "kind": "prefix_restored",
                "expectedState": deepcopy(challenge["expectedState"]),
                "leafRun": deepcopy(challenge["acceptedPrefix"]),
                "currentCheckpoint": {
                    "reportId": challenge["expectedState"]["reportId"],
                    "sequence": challenge["expectedState"]["sequence"],
                    "checkpointId": challenge["authorityProof"][
                        "authorizedStartCheckpointId"
                    ],
                    "previousCheckpointId": None,
                    "operation": "start",
                    "sceneFingerprintSha256": None,
                    "markerMatched": True,
                    "sessionSnapshotMatches": True,
                    "stageVerified": True,
                    "observedAt": observed_at,
                },
                "restoration": "prefix_observed_without_native_undo",
            },
            "retainsTargetLock": False,
            "automaticReplay": False,
            "occurredAt": observed_at,
        }

    def _retirement_ack(self, *, native_guard=None) -> dict:
        challenge = self._recovery_challenge(native_guard=native_guard)
        occurred_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return {
            "formatVersion": "1.0.0",
            "challenge": challenge,
            "recoveryId": challenge["recoveryId"],
            "requestId": challenge["originalDelivery"]["requestId"],
            "originalDeliveryId": challenge["originalDelivery"]["deliveryId"],
            "replacementSessionFingerprintSha256": challenge[
                "replacementSessionFingerprintSha256"
            ],
            "outcome": "document_incarnation_retired",
            "evidence": {
                "kind": "document_incarnation_retired",
                "reason": (
                    "native_undo_witness_lost_after_reload"
                    if native_guard is not None
                    else "runtime_recovery_evidence_lost"
                ),
                "mutationOutcome": "indeterminate",
                "requiresFreshDocumentIncarnation": True,
            },
            "retainsTargetLock": False,
            "automaticReplay": False,
            "occurredAt": occurred_at,
        }

    def test_poll_delivers_once_and_deduplicates_request_id(self) -> None:
        delivery = self._delivery()
        self.transport._request_json = lambda *_args, **_kwargs: {  # type: ignore[method-assign]
            "request": deepcopy(delivery)
        }
        self.transport._poll_leaf_operation_request()
        self.transport._poll_leaf_operation_request()
        self.assertEqual(
            self.transport.incoming.get_nowait(),
            {"kind": "leaf_operation_execute_request", "request": delivery},
        )
        self.assertTrue(self.transport.incoming.empty())

    def test_poll_rejects_hostile_shape_and_binding_changes(self) -> None:
        for mutate in (
            lambda item: item.update({"python": "bpy.ops.wm.quit_blender()"}),
            lambda item: item.update({"sourceOperationId": item["operationIds"][1]}),
            lambda item: item["operationParameters"].update({"rnaPath": "scene.render"}),
        ):
            delivery = self._delivery()
            mutate(delivery)
            self.transport._request_json = lambda *_args, value=delivery, **_kwargs: {  # type: ignore[method-assign]
                "request": deepcopy(value)
            }
            with self.assertRaises(ValueError):
                self.transport._poll_leaf_operation_request()

    def test_light_trails_delivery_accepts_exact_first_and_final_operations_only(self) -> None:
        for ordinal in (1, len(transport_module.LIGHT_TRAILS_LEAF_OPERATION_IDS)):
            delivery = self._light_trails_delivery(ordinal)
            self.assertEqual(
                self.transport._validate_leaf_operation_delivery(delivery), delivery
            )

        for mutate in (
            lambda item: item.update(
                {"recipeId": transport_module.TRANSFORM_GEOMETRY_LEAF_OPERATION_RECIPE}
            ),
            lambda item: item.update(
                {"operationIds": list(transport_module.TRANSFORM_GEOMETRY_LEAF_OPERATION_IDS)}
            ),
            lambda item: item.update(
                {"sourceOperationId": transport_module.LIGHT_TRAILS_LEAF_OPERATION_IDS[-2]}
            ),
        ):
            delivery = self._light_trails_delivery(
                len(transport_module.LIGHT_TRAILS_LEAF_OPERATION_IDS)
            )
            mutate(delivery)
            authority = {
                key: deepcopy(delivery[key])
                for key in transport_module.LEAF_OPERATION_AUTHORITY_KEYS
            }
            delivery["operationBindingSha256"] = self.transport._canonical_sha256(
                authority
            )
            with self.assertRaises(ValueError):
                self.transport._validate_leaf_operation_delivery(delivery)

    def test_recovery_poll_validates_and_deduplicates_without_replay(self) -> None:
        challenge = self._recovery_challenge()
        self.transport._request_json = lambda *_args, **_kwargs: {  # type: ignore[method-assign]
            "request": deepcopy(challenge)
        }
        self.assertTrue(self.transport._poll_leaf_operation_recovery_request())
        self.assertTrue(self.transport._poll_leaf_operation_recovery_request())
        self.assertEqual(
            self.transport.incoming.get_nowait(),
            {"kind": "leaf_operation_recovery_request", "request": challenge},
        )
        self.assertTrue(self.transport.incoming.empty())

    def test_recovery_poll_rejects_hostile_replay_and_guard_shapes(self) -> None:
        for mutate in (
            lambda item: item.update({"automaticReplay": True}),
            lambda item: item["acceptedPrefix"].update(
                {"completedOperationIds": [transport_module.TRANSFORM_GEOMETRY_LEAF_OPERATION_IDS[0]]}
            ),
            lambda item: item.update(
                {
                    "nativeUndoGuard": {
                        "expectedRestoredCheckpointId": None,
                        "recoveryTokenSha256": "9" * 64,
                        "python": "bpy.ops.ed.undo()",
                    }
                }
            ),
        ):
            challenge = self._recovery_challenge()
            mutate(challenge)
            self.transport._request_json = lambda *_args, value=challenge, **_kwargs: {  # type: ignore[method-assign]
                "request": deepcopy(value)
            }
            with self.assertRaises(ValueError):
                self.transport._poll_leaf_operation_recovery_request()

    def test_recovery_blocks_new_action_and_leaf_poll_in_same_cycle(self) -> None:
        self.transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=30.0,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=time.monotonic() + 30.0,
            heartbeat_sequence=0,
        )
        self.transport._request_json = lambda *_args, **_kwargs: {  # type: ignore[method-assign]
            "protocolVersion": "1.6.0",
            "plan": None,
            "planContentSha256": None,
            "proposal": None,
            "proposalPlanContentSha256": None,
            "procedureReplayCurrentStateRequest": None,
        }
        calls = []
        with patch.object(self.transport, "_poll_revision_history"), patch.object(
            self.transport, "_poll_revision_branches"
        ), patch.object(
            self.transport,
            "_poll_poke_compound_recovery_request",
            return_value=False,
        ), patch.object(
            self.transport,
            "_poll_poke_compound_request",
        ), patch.object(
            self.transport,
            "_poll_leaf_operation_recovery_request",
            side_effect=lambda: calls.append("recovery") or True,
        ), patch.object(
            self.transport,
            "_poll_action_request",
            side_effect=lambda: calls.append("action"),
        ), patch.object(
            self.transport,
            "_poll_leaf_operation_request",
            side_effect=lambda: calls.append("leaf"),
        ), patch.object(self.transport, "_poll_menu_control_proof_request"), patch.object(
            self.transport, "_poll_shortcut_proof_request"
        ), patch.object(self.transport, "_poll_execution_track_execution"), patch.object(
            self.transport, "_poll_execution_track_execution_recovery"
        ):
            self.transport._poll()
        self.assertEqual(calls, ["recovery"])

    def test_recovery_ack_queue_is_strict_and_emits_server_confirmation(self) -> None:
        ack = self._recovery_ack()
        hostile = deepcopy(ack)
        hostile["evidence"]["python"] = "bpy.ops.ed.undo()"
        with self.assertRaises(ValueError):
            self.transport.submit_leaf_operation_recovery_ack(hostile)

        self.transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=30.0,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=time.monotonic() + 30.0,
            heartbeat_sequence=0,
        )
        self.transport.submit_leaf_operation_recovery_ack(ack)

        def request_json(_method, path, _body=None, **_kwargs):
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            self.assertEqual(path, "/api/v1/companion/leaf-operation-recovery")
            self.transport._stop.set()
            return {"result": "duplicate"}

        self.transport._request_json = request_json  # type: ignore[method-assign]
        self.transport._flush_deadline = time.monotonic() + 5.0
        self.transport._run()
        incoming = []
        while not self.transport.incoming.empty():
            incoming.append(self.transport.incoming.get_nowait())
        self.assertIn(
            {
                "kind": "leaf_operation_recovery_acknowledged",
                "requestId": ack["requestId"],
                "recoveryId": ack["recoveryId"],
                "outcome": "prefix_restored",
            },
            incoming,
        )

    def test_document_retirement_ack_is_guard_bound_and_strict(self) -> None:
        ack = self._retirement_ack()
        self.assertEqual(
            self.transport._validate_leaf_operation_recovery_ack(ack), ack
        )
        hostile_reason = deepcopy(ack)
        hostile_reason["evidence"]["reason"] = (
            "native_undo_witness_lost_after_reload"
        )
        with self.assertRaises(ValueError):
            self.transport._validate_leaf_operation_recovery_ack(hostile_reason)
        hostile_lock = deepcopy(ack)
        hostile_lock["retainsTargetLock"] = True
        with self.assertRaises(ValueError):
            self.transport._validate_leaf_operation_recovery_ack(hostile_lock)

        native_ack = self._retirement_ack(
            native_guard={
                "expectedRestoredCheckpointId": str(uuid.uuid4()),
                "recoveryTokenSha256": "9" * 64,
            }
        )
        self.assertEqual(
            self.transport._validate_leaf_operation_recovery_ack(native_ack),
            native_ack,
        )

    def test_recovery_ack_survives_lost_response_and_waits_for_duplicate_confirmation(
        self,
    ) -> None:
        def session_snapshot() -> transport_module.CompanionSessionSnapshot:
            return transport_module.CompanionSessionSnapshot(
                lease_id=str(uuid.uuid4()),
                session_id=str(uuid.uuid4()),
                document_incarnation_id=str(uuid.uuid4()),
                negotiated_guide_protocol_version="1.6.0",
                heartbeat_interval_seconds=30.0,
                expires_at="2099-01-01T00:00:00Z",
                next_heartbeat_at=time.monotonic() + 30.0,
                heartbeat_sequence=0,
            )

        ack = self._recovery_ack()
        self.transport._session_snapshot = session_snapshot()
        self.transport.submit_leaf_operation_recovery_ack(ack)
        attempts = 0
        reconnects = 0

        def establish_session() -> None:
            nonlocal reconnects
            reconnects += 1
            self.transport._session_snapshot = session_snapshot()

        def request_json(_method, path, _body=None, **_kwargs):
            nonlocal attempts
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            self.assertEqual(path, "/api/v1/companion/leaf-operation-recovery")
            attempts += 1
            if attempts == 1:
                # Model a request committed by Runtime whose response was lost.
                # The immutable ACK must survive reconnect and receive duplicate.
                raise OSError("response lost after recovery ACK commit")
            self.transport._stop.set()
            return {"result": "duplicate"}

        self.transport._establish_session = establish_session  # type: ignore[method-assign]
        self.transport._request_json = request_json  # type: ignore[method-assign]
        self.transport._flush_deadline = time.monotonic() + 5.0
        self.transport._run()

        incoming = []
        while not self.transport.incoming.empty():
            incoming.append(self.transport.incoming.get_nowait())
        self.assertEqual((attempts, reconnects), (2, 1))
        self.assertIn(
            {
                "kind": "leaf_operation_recovery_acknowledged",
                "requestId": ack["requestId"],
                "recoveryId": ack["recoveryId"],
                "outcome": "prefix_restored",
            },
            incoming,
        )

    def test_recovery_required_result_rotates_only_the_live_lease(self) -> None:
        session = transport_module.CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=self.transport._session_id,
            document_incarnation_id=self.transport._document_incarnation_id,
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=30.0,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=time.monotonic() + 30.0,
            heartbeat_sequence=0,
        )
        self.transport._session_snapshot = session
        result = {
            "requestId": str(uuid.uuid4()),
            "status": "recovery_required",
            "progress": None,
        }
        self.transport.submit_leaf_operation_result(result)

        def request_json(_method, path, _body=None, **_kwargs):
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            self.assertEqual(path, "/api/v1/companion/leaf-operation-result")
            self.transport._stop.set()
            return {"result": "accepted"}

        self.transport._request_json = request_json  # type: ignore[method-assign]
        self.transport._flush_deadline = time.monotonic() + 5.0
        self.transport._run()
        self.assertIsNone(self.transport.session_snapshot)
        self.assertEqual(self.transport._session_id, session.session_id)
        self.assertEqual(
            self.transport._document_incarnation_id,
            session.document_incarnation_id,
        )

    def test_uncommitted_recovery_ack_is_not_replayed_after_lease_rejection(self) -> None:
        ack = self._recovery_ack()
        self.transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=self.transport._session_id,
            document_incarnation_id=self.transport._document_incarnation_id,
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=30.0,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=time.monotonic() + 30.0,
            heartbeat_sequence=0,
        )
        self.transport.submit_leaf_operation_recovery_ack(ack)
        attempts = 0

        def request_json(_method, path, _body=None, **_kwargs):
            nonlocal attempts
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            attempts += 1
            self.transport._stop.set()
            raise self._http_error(path, {"error": "lease_not_current"})

        self.transport._request_json = request_json  # type: ignore[method-assign]
        self.transport._flush_deadline = time.monotonic() + 5.0
        self.transport._run()
        self.assertEqual(attempts, 1)
        self.assertTrue(self.transport.leaf_operation_recovery_acks.empty())
        self.assertFalse(
            any(
                message.get("kind") == "leaf_operation_recovery_acknowledged"
                for message in list(self.transport.incoming.queue)
            )
        )

    def test_result_queue_is_independent_deepcopy_fifo(self) -> None:
        first = {"requestId": str(uuid.uuid4()), "progress": None}
        second = {"requestId": str(uuid.uuid4()), "progress": {"finalReport": None}}
        self.transport.submit_leaf_operation_result(first)
        self.transport.submit_leaf_operation_result(second)
        first["progress"] = {"tampered": True}
        self.assertEqual(self.transport.leaf_operation_results.get_nowait()["progress"], None)
        self.assertEqual(
            self.transport.leaf_operation_results.get_nowait()["requestId"],
            second["requestId"],
        )

    def test_final_report_is_posted_before_operation_11_result(self) -> None:
        report = {"reportId": str(uuid.uuid4()), "sequence": 8}
        result = {
            "requestId": str(uuid.uuid4()),
            "progress": {"finalReport": deepcopy(report)},
        }
        calls = []

        def request_json(method, path, body=None, **_kwargs):
            calls.append((method, path, deepcopy(body)))
            return {"result": "duplicate" if path.endswith("operation-result") else "accepted"}

        self.transport._request_json = request_json  # type: ignore[method-assign]
        self.transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=30.0,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=time.monotonic() + 30.0,
            heartbeat_sequence=0,
        )
        self.transport.send_report(report)
        self.transport.submit_leaf_operation_result(result)
        self.transport._flush_deadline = time.monotonic() + 5.0
        self.transport._stop.set()
        self.transport._run()

        self.assertEqual(
            [(method, path) for method, path, _body in calls],
            [
                ("POST", "/api/v1/companion/state"),
                ("POST", "/api/v1/companion/leaf-operation-result"),
            ],
        )
        self.assertEqual(
            self.transport.incoming.get_nowait(),
            {
                "kind": "leaf_operation_result_acknowledged",
                "requestId": result["requestId"],
            },
        )

    def test_real_leaf_operation_and_recovery_requests_carry_negotiated_lease_header(
        self,
    ) -> None:
        lease_id = str(uuid.uuid4())
        self.transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=lease_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=30.0,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=time.monotonic() + 30.0,
            heartbeat_sequence=0,
        )
        captured = []

        class Response:
            status = 200
            reason = "OK"
            headers = {}

            def __init__(self, body):
                self._body = body

            def read1(self, _size):
                body, self._body = self._body, b""
                return body

        class Connection:
            sock = None

            def __init__(self, *_args, **_kwargs):
                self._path = ""

            def request(self, method, path, body=None, headers=None):
                self._path = path
                captured.append((method, path, deepcopy(headers)))

            def getresponse(self):
                body = b'{"request":null}' if "leaf-operation?" in self._path else b'{"result":"accepted"}'
                return Response(body)

            def close(self):
                pass

        with patch.object(transport_module, "HTTPConnection", Connection):
            self.transport._request_json(
                "GET",
                "/api/v1/companion/leaf-operation?adapterId=blender&instanceId="
                + self.instance_id,
            )
            self.transport._request_json(
                "POST", "/api/v1/companion/leaf-operation-result", {"status": "failed"}
            )
            self.transport._request_json(
                "GET",
                "/api/v1/companion/leaf-operation-recovery?adapterId=blender&instanceId="
                + self.instance_id,
            )
            self.transport._request_json(
                "POST",
                "/api/v1/companion/leaf-operation-recovery",
                {"outcome": "prefix_restored"},
            )

        self.assertEqual(len(captured), 4)
        self.assertTrue(
            all(headers["x-operatingline-companion-lease"] == lease_id for _, _, headers in captured)
        )

    def test_intentional_stop_socket_error_does_not_emit_stale_connection_error(self) -> None:
        self.transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=30.0,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=time.monotonic() + 30.0,
            heartbeat_sequence=0,
        )

        def stopped_socket(*_args, **_kwargs):
            self.transport._flush_deadline = 0.0
            raise OSError("socket closed by intentional stop")

        self.transport._request_json = stopped_socket  # type: ignore[method-assign]
        self.transport.send_report({"reportId": str(uuid.uuid4()), "sequence": 8})
        self.transport._flush_deadline = time.monotonic() + 1.0
        self.transport._stop.set()
        self.transport._run()
        self.assertTrue(self.transport.incoming.empty())

    def test_retryable_leaf_result_lease_conflict_reconnects_without_dropping_pending(
        self,
    ) -> None:
        def session_snapshot() -> transport_module.CompanionSessionSnapshot:
            return transport_module.CompanionSessionSnapshot(
                lease_id=str(uuid.uuid4()),
                session_id=str(uuid.uuid4()),
                document_incarnation_id=str(uuid.uuid4()),
                negotiated_guide_protocol_version="1.6.0",
                heartbeat_interval_seconds=30.0,
                expires_at="2099-01-01T00:00:00Z",
                next_heartbeat_at=time.monotonic() + 30.0,
                heartbeat_sequence=0,
            )

        self.transport._session_snapshot = session_snapshot()
        result = {"requestId": str(uuid.uuid4()), "progress": None}
        self.transport.submit_leaf_operation_result(result)
        result_attempts = 0
        reconnects = 0

        def establish_session() -> None:
            nonlocal reconnects
            reconnects += 1
            self.transport._session_snapshot = session_snapshot()

        def request_json(_method, path, _body=None, **_kwargs):
            nonlocal result_attempts
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            self.assertEqual(path, "/api/v1/companion/leaf-operation-result")
            result_attempts += 1
            if result_attempts == 1:
                raise self._http_error(path, {"error": "lease_not_current"})
            self.transport._stop.set()
            return {"result": "accepted"}

        self.transport._establish_session = establish_session  # type: ignore[method-assign]
        self.transport._request_json = request_json  # type: ignore[method-assign]
        self.transport._flush_deadline = time.monotonic() + 5.0
        self.transport._run()

        incoming = []
        while not self.transport.incoming.empty():
            incoming.append(self.transport.incoming.get_nowait())
        self.assertEqual(result_attempts, 2)
        self.assertEqual(reconnects, 1)
        self.assertIn(
            {
                "kind": "leaf_operation_result_acknowledged",
                "requestId": result["requestId"],
            },
            incoming,
        )
        self.assertFalse(
            any(item.get("kind") == "leaf_operation_result_rejected" for item in incoming)
        )

    def test_leaf_result_identity_conflict_remains_a_permanent_rejection(self) -> None:
        self.transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=30.0,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=time.monotonic() + 30.0,
            heartbeat_sequence=0,
        )
        result = {"requestId": str(uuid.uuid4()), "progress": None}

        def rejected(_method, path, _body=None, **_kwargs):
            raise self._http_error(
                path,
                {"error": "leaf_operation_result_identity_mismatch"},
            )

        self.transport._request_json = rejected  # type: ignore[method-assign]
        self.transport.submit_leaf_operation_result(result)
        self.transport._flush_deadline = time.monotonic() + 5.0
        self.transport._stop.set()
        self.transport._run()
        self.assertEqual(
            self.transport.incoming.get_nowait(),
            {
                "kind": "leaf_operation_result_rejected",
                "requestId": result["requestId"],
                "message": "Runtime permanently rejected leaf-operation result (HTTP 409)",
            },
        )
        self.assertTrue(self.transport.incoming.empty())


if __name__ == "__main__":
    unittest.main()
