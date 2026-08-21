"""Pure-Python contract tests for the fixed UV Sphere menu-proof transport."""

import sys
import unittest
import uuid
from copy import deepcopy
from dataclasses import replace
from importlib import import_module
from pathlib import Path
from queue import Empty
from types import ModuleType
from urllib.error import HTTPError

PACKAGE_NAME = "operating_line_menu_companion_transport_test"
PACKAGE_ROOT = (
    Path(__file__).resolve().parents[3]
    / "adapters"
    / "blender"
    / "extension"
    / "operating_line"
)
package = ModuleType(PACKAGE_NAME)
package.__path__ = [str(PACKAGE_ROOT)]
sys.modules.setdefault(PACKAGE_NAME, package)
domain = import_module(f"{PACKAGE_NAME}.domain")
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
transport_module = import_module(f"{PACKAGE_NAME}.infrastructure.companion_transport")
CompanionTransport = transport_module.CompanionTransport
CompanionSessionSnapshot = transport_module.CompanionSessionSnapshot


NOW = "2026-08-22T10:00:03Z"
HASH = "a" * 64
OPERATIONS = list(transport_module.MENU_CONTROL_PROOF_OPERATION_IDS)


class MenuCompanionTransportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.instance_id = str(uuid.uuid4())
        self.session_id = str(uuid.uuid4())
        self.document_id = str(uuid.uuid4())
        self.transport = CompanionTransport(
            "http://127.0.0.1:4123",
            "test-token-at-least-sixteen-characters",
            self.instance_id,
            session_id=self.session_id,
            document_incarnation_id=self.document_id,
            poll_interval=0.01,
        )
        self.transport._session_snapshot = self._session()

    def _session(self) -> CompanionSessionSnapshot:
        return CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=self.session_id,
            document_incarnation_id=self.document_id,
            negotiated_guide_protocol_version=domain.PROTOCOL_VERSION,
            heartbeat_interval_seconds=60,
            expires_at="2026-08-22T11:00:00Z",
            next_heartbeat_at=10**20,
            heartbeat_sequence=0,
        )

    def _binding(self) -> dict:
        plan = {"id": "plan-menu-proof", "revision": 1, "contentSha256": HASH}
        start = {
            "reportId": str(uuid.uuid4()),
            "sequence": 7,
            "adapterId": "blender",
            "instanceId": self.instance_id,
            "plan": {"id": plan["id"], "revision": plan["revision"]},
            "planContentSha256": plan["contentSha256"],
            "executionId": str(uuid.uuid4()),
            "phase": "running",
            "activeStepId": None,
            "completedStepIds": [],
            "transition": "walkthrough_started",
            "stepId": None,
            "observationCount": 0,
            "nativeUndoCheckpoint": {
                "formatVersion": "1.0.0",
                "evidenceClass": "companion_reported_native_undo_checkpoint",
                "checkpointId": str(uuid.uuid4()),
                "previousCheckpointId": None,
                "operation": "start",
                "committedAt": "2026-08-22T09:59:59Z",
                "marker": {
                    "key": "_operating_line_native_history_v1",
                    "matched": True,
                },
                "journal": {
                    "entryPresent": True,
                    "snapshotMatchesSession": True,
                    "artifactsBackedUp": True,
                },
                "session": {
                    "plan": {"id": plan["id"], "revision": plan["revision"]},
                    "planContentSha256": plan["contentSha256"],
                    "executionId": "",
                    "activeStepId": None,
                    "completedStepIds": [],
                    "receiptStepIds": [],
                },
            },
            "occurredAt": "2026-08-22T10:00:00Z",
        }
        start["nativeUndoCheckpoint"]["session"]["executionId"] = start["executionId"]
        materialization = {
            "actionCatalogVersion": domain.BLENDER_ACTION_CATALOG_VERSION,
            "interactionCatalogVersion": "1.0.0",
            "interactionCatalogContentSha256": HASH,
            "packetContentSha256": HASH,
            "inputTreeContentSha256": HASH,
            "outputTreeContentSha256": HASH,
            "materializationContentSha256": HASH,
            "menuTrackContentSha256": HASH,
        }
        binding = {
            "formatVersion": "1.0.0",
            "bindingId": str(uuid.uuid4()),
            "proposalRecordContentSha256": HASH,
            "proofId": str(uuid.uuid4()),
            "requestId": str(uuid.uuid4()),
            "replayId": str(uuid.uuid4()),
            "target": {"adapterId": "blender", "instanceId": self.instance_id},
            "proposalId": str(uuid.uuid4()),
            "packetContentSha256": HASH,
            "inputTreeContentSha256": HASH,
            "outputTreeContentSha256": HASH,
            "materializationContentSha256": HASH,
            "proposalContentSha256": HASH,
            "plan": plan,
            "executionId": start["executionId"],
            "leafId": "tutorial.uv-sphere-proof",
            "recipeId": "blender.mesh.create_uv_sphere.native",
            "actionName": "blender.mesh.create_uv_sphere",
            "acceptedAction": {
                "adapterId": "blender",
                "name": "blender.mesh.create_uv_sphere",
                "arguments": {
                    "resourceId": "proof.uv_sphere.eye",
                    "objectName": "OperatingLine.TutorialEye",
                    "radius": 1.5,
                    "location": [1.25, -2, 0.75],
                },
            },
            "targetProfile": "factory_layout_three_object_ui_scale_2",
            "acceptedDecision": {
                "decisionId": str(uuid.uuid4()),
                "proposalId": "",
                "instanceId": self.instance_id,
                "adapterId": "blender",
                "decision": "accepted",
                "decidedAt": "2026-08-22T09:59:58Z",
            },
            "startState": start,
            "proofScope": {
                "managedActionResult": "not_executed",
                "managedIdentityVerified": False,
                "managedReceiptCreated": False,
                "omittedAcceptedArguments": ["resourceId"],
            },
            "materialization": materialization,
            "executorId": "blender.uv_sphere_menu_controls.event_simulate.v1",
            "executionBoundary": "blender_window_event_simulate",
            "authorization": "accepted_replay_next_step",
            "transport": "event_simulate",
            "operationIds": list(OPERATIONS),
            "nativeUndoDepth": 8,
            "createdAt": "2026-08-22T10:00:00Z",
        }
        binding["acceptedDecision"]["proposalId"] = binding["proposalId"]
        binding["integrity"] = {
            "algorithm": "sha256",
            "canonicalization": "operatingline-json-value-v1",
            "contentSha256": CompanionTransport._canonical_sha256(binding),
        }
        return binding

    def _delivery(self) -> dict:
        binding = self._binding()
        session = self.transport.session_snapshot
        assert session is not None
        return {
            "formatVersion": "1.0.0",
            "requestId": binding["requestId"],
            "replayId": binding["replayId"],
            "proofId": binding["proofId"],
            "target": deepcopy(binding["target"]),
            "targetProfile": binding["targetProfile"],
            "proposalId": binding["proposalId"],
            "proposalRecordContentSha256": binding["proposalRecordContentSha256"],
            "proposalContentSha256": binding["proposalContentSha256"],
            "plan": deepcopy(binding["plan"]),
            "executionId": binding["executionId"],
            "leafId": binding["leafId"],
            "packetContentSha256": binding["packetContentSha256"],
            "inputTreeContentSha256": binding["inputTreeContentSha256"],
            "outputTreeContentSha256": binding["outputTreeContentSha256"],
            "materializationContentSha256": binding["materializationContentSha256"],
            "interactionCatalogVersion": binding["materialization"][
                "interactionCatalogVersion"
            ],
            "interactionCatalogContentSha256": binding["materialization"][
                "interactionCatalogContentSha256"
            ],
            "menuTrackContentSha256": binding["materialization"][
                "menuTrackContentSha256"
            ],
            "bindingContentSha256": binding["integrity"]["contentSha256"],
            "binding": binding,
            "executorId": binding["executorId"],
            "executionBoundary": binding["executionBoundary"],
            "authorization": binding["authorization"],
            "transport": binding["transport"],
            "operationIds": list(OPERATIONS),
            "nativeUndoDepth": 8,
            "expectedState": {
                "reportId": binding["startState"]["reportId"],
                "sequence": binding["startState"]["sequence"],
            },
            "startCheckpoint": deepcopy(binding["startState"]),
            "requestedAt": "2026-08-22T10:00:01Z",
            "deliveryId": str(uuid.uuid4()),
            "lease": {
                "leaseId": session.lease_id,
                "sessionId": session.session_id,
                "target": deepcopy(binding["target"]),
                "documentIncarnationId": session.document_incarnation_id,
                "expiresAt": "2026-08-22T11:00:00Z",
            },
            "dispatchedAt": "2026-08-22T10:00:02Z",
        }

    def _receipt(self, delivery: dict) -> dict:
        content = {
            "receiptId": str(uuid.uuid4()),
            "proofId": delivery["proofId"],
            "requestId": delivery["requestId"],
            "deliveryId": delivery["deliveryId"],
            "bindingContentSha256": delivery["bindingContentSha256"],
            "operationId": OPERATIONS[0],
            "order": 1,
            "previousReceiptContentSha256": None,
            "outcome": "succeeded",
            "summary": {"status": "precondition_verified", "path": ["Layout"]},
            "occurredAt": NOW,
        }
        return {
            **content,
            "contentSha256": CompanionTransport._canonical_sha256(content),
        }

    def _receipts(self, delivery: dict) -> list[dict]:
        summaries = (
            {"status": "precondition_verified", "path": ["Layout"]},
            {"status": "control_executed", "path": ["Layout", "Add"]},
            {
                "status": "control_executed",
                "path": ["Layout", "Add", "Mesh"],
            },
            {
                "status": "control_executed",
                "path": ["Layout", "Add", "Mesh", "UV Sphere"],
                "radius": 1,
            },
            {
                "status": "control_executed",
                "path": ["Sidebar", "Item", "Transform", "Location"],
                "value": [1.25, -2, 0.75],
            },
            {
                "status": "control_executed",
                "path": ["Sidebar", "Item", "Transform", "Scale"],
                "value": [1.5, 1.5, 1.5],
            },
            {
                "status": "control_executed",
                "path": ["Properties", "Object", "Name"],
                "value": "OperatingLine.TutorialEye",
            },
        )
        receipts = []
        previous = None
        for index, (operation_id, summary) in enumerate(
            zip(OPERATIONS, summaries, strict=True), start=1
        ):
            content = {
                "receiptId": str(uuid.uuid4()),
                "proofId": delivery["proofId"],
                "requestId": delivery["requestId"],
                "deliveryId": delivery["deliveryId"],
                "bindingContentSha256": delivery["bindingContentSha256"],
                "operationId": operation_id,
                "order": index,
                "previousReceiptContentSha256": previous,
                "outcome": "succeeded",
                "summary": summary,
                "occurredAt": NOW,
            }
            receipt = {
                **content,
                "contentSha256": CompanionTransport._canonical_sha256(content),
            }
            receipts.append(receipt)
            previous = receipt["contentSha256"]
        return receipts

    def _progress(self, delivery: dict) -> dict:
        receipt = self._receipt(delivery)
        return {
            **deepcopy(delivery),
            "status": "in_progress",
            "completedOperationIds": [OPERATIONS[0]],
            "operationReceipts": [receipt],
            "receiptChainHeadSha256": receipt["contentSha256"],
            "nativeHistoryCursor": 0,
            "completedMutationStages": [],
            "occurredAt": NOW,
        }

    def _result(self, delivery: dict) -> dict:
        return {
            **deepcopy(delivery),
            "status": "failed_no_mutation",
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "managedReceiptCreated": False,
            "requiresUndoToUnlock": False,
            "terminalEvidence": {
                "kind": "failed_no_mutation",
                "receiptPrefix": [],
                "lastCompletedOperationId": None,
                "internalHistoryCursor": 0,
                "completedMutationStages": [],
                "automaticReplay": False,
            },
            "error": "Injected preflight failure",
            "occurredAt": NOW,
        }

    def _checkpointed_result(self, delivery: dict) -> dict:
        receipts = self._receipts(delivery)[:4]
        stages = [transport_module.MENU_CONTROL_PROOF_MUTATION_STAGES[0]]
        checkpoint = {
            "formatVersion": "1.0.0",
            "checkpointId": str(uuid.uuid4()),
            "undoLockId": str(uuid.uuid4()),
            "proofId": delivery["proofId"],
            "replayId": delivery["replayId"],
            "target": {**deepcopy(delivery["target"]), "resourceId": "proof.uv_sphere.eye"},
            "internalHistoryCursor": 1,
            "completedMutationStages": stages,
            "baselineSceneFingerprintSha256": "b" * 64,
            "currentSceneFingerprintSha256": "c" * 64,
            "receiptChainRootSha256": receipts[0]["contentSha256"],
            "receiptChainHeadSha256": receipts[-1]["contentSha256"],
            "committedAt": NOW,
        }
        checkpoint["contentSha256"] = CompanionTransport._canonical_sha256(checkpoint)
        return {
            **deepcopy(delivery),
            "status": "failed_checkpointed",
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "managedReceiptCreated": False,
            "requiresUndoToUnlock": True,
            "terminalEvidence": {
                "kind": "failed_checkpointed",
                "checkpoint": checkpoint,
                "receiptPrefix": receipts,
                "lastCompletedOperationId": OPERATIONS[3],
                "internalHistoryCursor": 1,
                "completedMutationStages": stages,
                "baselineSceneFingerprintSha256": "b" * 64,
                "currentSceneFingerprintSha256": "c" * 64,
                "automaticReplay": False,
            },
            "error": "Injected checkpointed failure",
            "occurredAt": NOW,
        }

    def _terminal_reconciliation(self, delivery: dict, result: dict) -> dict:
        session = self.transport.session_snapshot
        assert session is not None
        receipts = result["terminalEvidence"]["receiptPrefix"]
        return {
            **deepcopy(delivery),
            "kind": "native_terminal_reconcile",
            "recoveryId": str(uuid.uuid4()),
            "replacementLease": {
                "leaseId": session.lease_id,
                "sessionId": session.session_id,
                "target": deepcopy(delivery["target"]),
                "documentIncarnationId": session.document_incarnation_id,
                "expiresAt": session.expires_at,
            },
            "acknowledgedProgressReceiptChainHeads": [
                receipt["contentSha256"] for receipt in receipts[:2]
            ],
            "recoveryRequestedAt": "2026-08-22T10:00:04Z",
        }

    @staticmethod
    def _terminal_marker_hash(result: dict) -> str:
        terminal = result["terminalEvidence"]
        checkpoint = terminal["checkpoint"]
        return CompanionTransport._canonical_sha256(
            {
                "formatVersion": "1.0.0",
                "executorId": result["executorId"],
                "checkpointId": checkpoint["checkpointId"],
                "undoLockId": checkpoint["undoLockId"],
                "proofId": result["proofId"],
                "replayId": result["replayId"],
                "targetId": result["binding"]["acceptedAction"]["arguments"][
                    "resourceId"
                ],
                "checkpointKind": "failure",
                "baselineSceneFingerprintSha256": checkpoint[
                    "baselineSceneFingerprintSha256"
                ],
                "lockedSceneFingerprintSha256": checkpoint[
                    "currentSceneFingerprintSha256"
                ],
                "terminalResultContentSha256": CompanionTransport._canonical_sha256(
                    result
                ),
            }
        )

    def test_valid_poll_deduplicates_on_the_controller_incoming_queue(self) -> None:
        delivery = self._delivery()
        self.transport._request_json = lambda *_args, **_kwargs: {"request": delivery}

        self.transport._poll_menu_control_proof_request()
        self.transport._poll_menu_control_proof_request()

        self.assertEqual(
            self.transport.incoming.get_nowait(),
            {"kind": "menu_control_proof_execute_request", "request": delivery},
        )
        with self.assertRaises(Empty):
            self.transport.incoming.get_nowait()

    def test_poll_strictly_rejects_malformed_or_tampered_delivery(self) -> None:
        for mutate, message in (
            (lambda value: value.update({"unexpected": True}), "invalid fields"),
            (lambda value: value["operationIds"].reverse(), "immutable binding"),
            (
                lambda value: value["lease"].update(
                    {"documentIncarnationId": str(uuid.uuid4())}
                ),
                "session or document",
            ),
            (
                lambda value: value["lease"].update(
                    {"leaseId": str(uuid.uuid4())}
                ),
                "current document lease",
            ),
        ):
            delivery = self._delivery()
            mutate(delivery)
            self.transport._request_json = (
                lambda *_args, candidate=delivery, **_kwargs: {"request": candidate}
            )
            with self.assertRaisesRegex(ValueError, message):
                self.transport._poll_menu_control_proof_request()

        delivery = self._delivery()
        delivery["binding"]["acceptedAction"]["arguments"]["radius"] = 2
        self.transport._request_json = lambda *_args, **_kwargs: {"request": delivery}
        with self.assertRaisesRegex(ValueError, "fixed UV Sphere"):
            self.transport._poll_menu_control_proof_request()

    def test_submit_validates_progress_and_terminal_result(self) -> None:
        delivery = self._delivery()
        progress = self._progress(delivery)
        result = self._result(delivery)

        self.transport.submit_menu_control_proof_progress(progress)
        self.transport.submit_menu_control_proof_result(result)
        self.assertEqual(
            self.transport.menu_control_proof_progress.get_nowait(), progress
        )
        self.assertEqual(self.transport.menu_control_proof_results.get_nowait(), result)

        invalid = deepcopy(progress)
        invalid["nativeHistoryCursor"] = 1
        with self.assertRaisesRegex(ValueError, "exact logical prefix"):
            self.transport.submit_menu_control_proof_progress(invalid)
        invalid_result = deepcopy(result)
        invalid_result["managedReceiptCreated"] = True
        with self.assertRaisesRegex(ValueError, "status claims"):
            self.transport.submit_menu_control_proof_result(invalid_result)

    def test_probe_recovery_accepts_completed_history_with_each_current_cursor(
        self,
    ) -> None:
        delivery = self._delivery()
        receipts = self._receipts(delivery)
        stages = list(transport_module.MENU_CONTROL_PROOF_MUTATION_STAGES)
        for cursor in range(9):
            with self.subTest(cursor=cursor):
                result = {
                    **deepcopy(delivery),
                    "status": "recovery_required",
                    "managedActionResult": "not_executed",
                    "managedIdentityVerified": False,
                    "managedReceiptCreated": False,
                    "requiresUndoToUnlock": True,
                    "terminalEvidence": {
                        "kind": "recovery_required",
                        "receiptPrefix": deepcopy(receipts),
                        "lastCompletedOperationId": OPERATIONS[-1],
                        "internalHistoryCursor": cursor,
                        "completedMutationStages": stages,
                        "baselineSceneFingerprintSha256": "b" * 64,
                        "currentSceneFingerprintSha256": "c" * 64,
                        "automaticReplay": False,
                    },
                    "error": "Injected native-history probe failure",
                    "occurredAt": NOW,
                }
                self.transport.submit_menu_control_proof_result(result)
                self.assertEqual(
                    self.transport.menu_control_proof_results.get_nowait(), result
                )

        invalid = deepcopy(result)
        invalid["terminalEvidence"]["receiptPrefix"] = receipts[:4]
        invalid["terminalEvidence"]["lastCompletedOperationId"] = OPERATIONS[3]
        invalid["terminalEvidence"]["completedMutationStages"] = stages[:1]
        invalid["terminalEvidence"]["internalHistoryCursor"] = 0
        with self.assertRaisesRegex(ValueError, "recovery evidence"):
            self.transport.submit_menu_control_proof_result(invalid)

        restored = deepcopy(result)
        restored["status"] = "failed_restored"
        restored["requiresUndoToUnlock"] = False
        restored["terminalEvidence"]["kind"] = "failed_restored"
        restored["terminalEvidence"]["receiptPrefix"] = receipts[:4]
        restored["terminalEvidence"]["lastCompletedOperationId"] = OPERATIONS[3]
        restored["terminalEvidence"]["internalHistoryCursor"] = 0
        restored["terminalEvidence"]["completedMutationStages"] = stages[:1]
        restored["terminalEvidence"]["currentSceneFingerprintSha256"] = "b" * 64
        self.transport.submit_menu_control_proof_result(restored)
        self.assertEqual(
            self.transport.menu_control_proof_results.get_nowait(), restored
        )

    def test_worker_posts_all_progress_before_result_and_emits_acks(self) -> None:
        delivery = self._delivery()
        progress = self._progress(delivery)
        result = self._result(delivery)
        calls = []

        def request_json(_method, path, body=None, **_kwargs):
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            if path.startswith("/api/v1/companion/menu-control-proof"):
                calls.append((path, body))
                return {
                    "result": "duplicate" if path.endswith("result") else "accepted"
                }
            raise AssertionError(path)

        self.transport._request_json = request_json
        self.transport._poll = lambda: None
        self.transport.submit_menu_control_proof_progress(progress)
        self.transport.submit_menu_control_proof_result(result)
        self.transport._menu_control_proof_inflight_request_id = delivery["requestId"]
        self.transport.start()
        self.transport.stop(flush_timeout=0.5)
        self.assertTrue(self.transport.wait_stopped(1))
        self.assertEqual(
            [path for path, _body in calls],
            [
                "/api/v1/companion/menu-control-proof-progress",
                "/api/v1/companion/menu-control-proof-result",
            ],
        )
        messages = []
        while not self.transport.incoming.empty():
            messages.append(self.transport.incoming.get_nowait())
        menu_messages = [
            message
            for message in messages
            if message["kind"].startswith("menu_control_proof_")
        ]
        self.assertEqual(
            [message["kind"] for message in menu_messages],
            [
                "menu_control_proof_progress_acknowledged",
                "menu_control_proof_result_acknowledged",
            ],
        )
        self.assertIsNone(self.transport._menu_control_proof_inflight_request_id)

    def test_progress_http_error_blocks_terminal_post_and_clears_after_drop(
        self,
    ) -> None:
        delivery = self._delivery()
        calls = []

        def request_json(_method, path, _body=None, **_kwargs):
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            calls.append(path)
            raise HTTPError(path, 409, "Conflict", {}, None)

        self.transport._request_json = request_json
        self.transport._poll = lambda: None
        self.transport.submit_menu_control_proof_progress(self._progress(delivery))
        self.transport.submit_menu_control_proof_result(self._result(delivery))
        self.transport._menu_control_proof_inflight_request_id = delivery["requestId"]
        self.transport.start()
        self.transport.stop(flush_timeout=0.5)
        self.assertTrue(self.transport.wait_stopped(1))
        self.assertEqual(calls, ["/api/v1/companion/menu-control-proof-progress"])
        self.assertIsNone(self.transport._menu_control_proof_inflight_request_id)
        messages = []
        while not self.transport.incoming.empty():
            messages.append(self.transport.incoming.get_nowait())
        self.assertIn(
            "menu_control_proof_progress_rejected",
            {message["kind"] for message in messages},
        )

    def test_terminal_http_error_emits_rejection_and_clears_inflight(self) -> None:
        delivery = self._delivery()
        calls = []

        def request_json(_method, path, _body=None, **_kwargs):
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            calls.append(path)
            raise HTTPError(path, 400, "Bad Request", {}, None)

        self.transport._request_json = request_json
        self.transport._poll = lambda: None
        self.transport.submit_menu_control_proof_result(self._result(delivery))
        self.transport._menu_control_proof_inflight_request_id = delivery["requestId"]
        self.transport.start()
        self.transport.stop(flush_timeout=0.5)
        self.assertTrue(self.transport.wait_stopped(1))
        self.assertEqual(calls, ["/api/v1/companion/menu-control-proof-result"])
        self.assertIsNone(self.transport._menu_control_proof_inflight_request_id)
        messages = []
        while not self.transport.incoming.empty():
            messages.append(self.transport.incoming.get_nowait())
        self.assertIn(
            "menu_control_proof_result_rejected",
            {message["kind"] for message in messages},
        )

    def test_same_document_lease_rotation_preserves_delivery_and_dedupe_state(
        self,
    ) -> None:
        delivery = self._delivery()
        self.transport._request_json = lambda *_args, **_kwargs: {"request": delivery}
        self.transport._poll_menu_control_proof_request()
        old_session = self.transport.session_snapshot
        assert old_session is not None

        self.transport._clear_session()
        self.assertEqual(
            self.transport._menu_control_proof_inflight_request_id,
            delivery["requestId"],
        )
        self.transport._session_snapshot = replace(
            old_session, lease_id=str(uuid.uuid4())
        )
        self.transport.submit_menu_control_proof_progress(self._progress(delivery))
        self.transport._poll_menu_control_proof_request()
        self.assertEqual(
            self.transport.incoming.get_nowait()["request"]["requestId"],
            delivery["requestId"],
        )
        with self.assertRaises(Empty):
            self.transport.incoming.get_nowait()

    def test_terminal_reconciliation_uses_current_replacement_lease_without_replay(
        self,
    ) -> None:
        delivery = self._delivery()
        result = self._checkpointed_result(delivery)
        old_session = self.transport.session_snapshot
        assert old_session is not None
        self.transport._session_snapshot = replace(
            old_session,
            lease_id=str(uuid.uuid4()),
        )
        recovery = self._terminal_reconciliation(delivery, result)
        renewed_session = self.transport.session_snapshot
        assert renewed_session is not None
        self.transport._session_snapshot = replace(
            renewed_session,
            expires_at="2026-08-22T11:30:00Z",
        )
        self.transport._request_json = lambda *_args, **_kwargs: {"request": recovery}

        self.transport._poll_menu_control_proof_request()

        self.assertEqual(
            self.transport.incoming.get_nowait(),
            {
                "kind": "menu_control_proof_terminal_reconcile_request",
                "request": recovery,
            },
        )
        ack = {
            "kind": "native_terminal_reconcile",
            "recoveryId": recovery["recoveryId"],
            "result": result,
            "terminalResultContentSha256": CompanionTransport._canonical_sha256(result),
            "expectedMarkerContentSha256": self._terminal_marker_hash(result),
            "currentSceneFingerprintSha256": "c" * 64,
            "occurredAt": "2026-08-22T10:00:05Z",
        }
        self.transport.submit_menu_control_proof_recovery_ack(ack)
        self.assertEqual(
            self.transport.menu_control_proof_recovery_acks.get_nowait(), ack
        )

        tampered = deepcopy(ack)
        tampered["result"]["terminalEvidence"]["receiptPrefix"][0][
            "contentSha256"
        ] = "e" * 64
        with self.assertRaises(ValueError):
            self.transport.submit_menu_control_proof_recovery_ack(tampered)

    def test_worker_posts_terminal_reconciliation_on_independent_channel(self) -> None:
        delivery = self._delivery()
        result = self._checkpointed_result(delivery)
        old_session = self.transport.session_snapshot
        assert old_session is not None
        self.transport._session_snapshot = replace(
            old_session,
            lease_id=str(uuid.uuid4()),
        )
        recovery = self._terminal_reconciliation(delivery, result)
        self.transport._menu_control_proof_reconciliations[recovery["recoveryId"]] = recovery
        ack = {
            "kind": "native_terminal_reconcile",
            "recoveryId": recovery["recoveryId"],
            "result": result,
            "terminalResultContentSha256": CompanionTransport._canonical_sha256(result),
            "expectedMarkerContentSha256": self._terminal_marker_hash(result),
            "currentSceneFingerprintSha256": "c" * 64,
            "occurredAt": "2026-08-22T10:00:05Z",
        }
        calls = []

        def request_json(_method, path, body=None, **_kwargs):
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            calls.append((path, body))
            return {"result": "accepted"}

        self.transport._request_json = request_json
        self.transport._poll = lambda: None
        self.transport.submit_menu_control_proof_recovery_ack(ack)
        self.transport.start()
        self.transport.stop(flush_timeout=0.5)
        self.assertTrue(self.transport.wait_stopped(1))
        self.assertEqual(
            calls,
            [("/api/v1/companion/menu-control-proof-recovery", ack)],
        )
        messages = []
        while not self.transport.incoming.empty():
            messages.append(self.transport.incoming.get_nowait())
        acknowledged = next(
            message
            for message in messages
            if message["kind"] == "menu_control_proof_recovery_acknowledged"
        )
        self.assertEqual(
            acknowledged["resultContentSha256"],
            ack["terminalResultContentSha256"],
        )


if __name__ == "__main__":
    unittest.main()
