"""Pure-Python contract tests for the independent shortcut-proof transport."""

from copy import deepcopy
from importlib import import_module
from pathlib import Path
from queue import Empty
import sys
from types import ModuleType
import unittest
import uuid


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_shortcut_transport_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line
domain = import_module(f"{PACKAGE_NAME}.domain")
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
transport_module = import_module(f"{PACKAGE_NAME}.infrastructure.companion_transport")
CompanionTransport = transport_module.CompanionTransport


NOW = "2026-08-20T12:00:00Z"
OPERATIONS = [
    "shortcut.add_subdivision_surface_level_one",
    "shortcut.open_adjust_last_operation",
    "shortcut.set_viewport_level",
    "shortcut.close_adjust_last_operation",
]
CANONICAL_HASH_VECTOR = {
    "10": "ten",
    "2": "two",
    "é": "accent",
    "😀": "emoji",
    "text": "hello 😀",
    "small": 1e-7,
    "large": 1e20,
    "zero": -0.0,
}
CANONICAL_HASH_VECTOR_SHA256 = (
    "53034233732c02e4a0058220b140da17c9fe8242f55c9455bdb7724529980149"
)


class ShortcutCompanionTransportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.instance_id = str(uuid.uuid4())
        self.transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            self.instance_id,
        )

    def test_canonical_hash_matches_protocol_shared_vector(self) -> None:
        self.assertEqual(
            CompanionTransport._canonical_sha256(CANONICAL_HASH_VECTOR),
            CANONICAL_HASH_VECTOR_SHA256,
        )

    def _binding(self) -> dict:
        proposal_id = str(uuid.uuid4())
        binding = {
            "formatVersion": "1.0.0",
            "bindingId": str(uuid.uuid4()),
            "proposalRecordContentSha256": "1" * 64,
            "proofId": str(uuid.uuid4()),
            "requestId": str(uuid.uuid4()),
            "replayId": str(uuid.uuid4()),
            "target": {"adapterId": "blender", "instanceId": self.instance_id},
            "proposalId": proposal_id,
            "plan": {"id": "plan-1", "revision": 1, "contentSha256": "2" * 64},
            "executionId": str(uuid.uuid4()),
            "leafId": "leaf.subdivision",
            "recipeId": "blender.modifier.add_subdivision_surface.semantic",
            "actionName": "blender.modifier.add_subdivision_surface",
            "acceptedAction": {
                "adapterId": "blender",
                "name": "blender.modifier.add_subdivision_surface",
                "arguments": {
                    "targetId": "tutorial.cube",
                    "modifierId": "tutorial.cube.subdivision_surface",
                    "modifierName": "OperatingLine.Cube.SubdivisionSurface",
                    "viewportLevel": 2,
                },
            },
            "targetProfile": "factory_cube_8_12_6",
            "acceptedDecision": {
                "decisionId": str(uuid.uuid4()),
                "proposalId": proposal_id,
                "instanceId": self.instance_id,
                "adapterId": "blender",
                "decision": "accepted",
                "decidedAt": NOW,
            },
            "proofScope": {
                "managedActionResult": "not_executed",
                "managedIdentityVerified": False,
                "managedReceiptCreated": False,
                "omittedAcceptedArguments": ["modifierId", "modifierName"],
            },
            "materialization": {
                "actionCatalogVersion": domain.BLENDER_ACTION_CATALOG_VERSION,
                "interactionCatalogVersion": "1.39.0",
                "interactionCatalogContentSha256": "3" * 64,
                "shortcutTrackContentSha256": "4" * 64,
            },
            "executorId": "blender.subdivision_surface_f9.event_simulate.v1",
            "executionBoundary": "blender_window_event_simulate",
            "authorization": "accepted_replay_next_step",
            "transport": "event_simulate",
            "operationIds": OPERATIONS,
            "startState": {"reportId": str(uuid.uuid4()), "sequence": 7},
            "createdAt": NOW,
        }
        binding["integrity"] = {
            "algorithm": "sha256",
            "canonicalization": "operatingline-json-value-v1",
            "contentSha256": CompanionTransport._canonical_sha256(binding),
        }
        return binding

    def _delivery(self) -> dict:
        binding = self._binding()
        return {
            "formatVersion": "1.0.0",
            "requestId": binding["requestId"],
            "replayId": binding["replayId"],
            "proofId": binding["proofId"],
            "deliveryId": str(uuid.uuid4()),
            "target": deepcopy(binding["target"]),
            "targetProfile": binding["targetProfile"],
            "proposalId": binding["proposalId"],
            "plan": deepcopy(binding["plan"]),
            "executionId": binding["executionId"],
            "leafId": binding["leafId"],
            "interactionCatalogVersion": binding["materialization"]["interactionCatalogVersion"],
            "interactionCatalogContentSha256": binding["materialization"]["interactionCatalogContentSha256"],
            "shortcutTrackContentSha256": binding["materialization"]["shortcutTrackContentSha256"],
            "bindingContentSha256": binding["integrity"]["contentSha256"],
            "binding": binding,
            "executorId": binding["executorId"],
            "executionBoundary": binding["executionBoundary"],
            "authorization": binding["authorization"],
            "transport": binding["transport"],
            "operationIds": list(OPERATIONS),
            "expectedState": deepcopy(binding["startState"]),
            "requestedAt": NOW,
            "dispatchedAt": NOW,
        }

    def _recovery_delivery(self) -> dict:
        delivery = self._delivery()
        delivery.update(
            {
                "kind": "native_history_rebind",
                "recoveryId": str(uuid.uuid4()),
                "history": {
                    "checkpointId": str(uuid.uuid4()),
                    "undoLockId": str(uuid.uuid4()),
                    "checkpointKind": "success",
                    "baselineSceneFingerprintSha256": "6" * 64,
                    "lockedSceneFingerprintSha256": "7" * 64,
                    "terminalResultContentSha256": "9" * 64,
                },
                "expectedMarkerContentSha256": "8" * 64,
                "expectedResultContentSha256": "9" * 64,
                "expectedStatus": "succeeded",
                "recoveryRequestedAt": NOW,
            }
        )
        return delivery

    @staticmethod
    def _event(event_type: str, value: str, *, ctrl: bool = False) -> dict:
        return {
            "type": event_type,
            "value": value,
            "ctrl": ctrl,
            "shift": False,
            "point": {"x": 100, "y": 100, "role": "viewport_center"},
        }

    def _receipts(self, delivery: dict) -> list[dict]:
        event_sets = [
            [self._event("ONE", "PRESS", ctrl=True), self._event("ONE", "RELEASE", ctrl=True)],
            [self._event("F9", "PRESS"), self._event("F9", "RELEASE")],
            [
                {**self._event("MOUSEMOVE", "NOTHING"), "point": {"x": 200, "y": 200, "role": "level_control"}},
                {**self._event("LEFTMOUSE", "PRESS"), "point": {"x": 200, "y": 200, "role": "level_control"}},
                {**self._event("LEFTMOUSE", "RELEASE"), "point": {"x": 200, "y": 200, "role": "level_control"}},
                {**self._event("LEFTMOUSE", "PRESS"), "point": {"x": 200, "y": 200, "role": "level_control"}},
                {**self._event("LEFTMOUSE", "RELEASE"), "point": {"x": 200, "y": 200, "role": "level_control"}},
                self._event("A", "PRESS", ctrl=True),
                {**self._event("TWO", "PRESS"), "unicode": "2"},
                self._event("RET", "PRESS"),
                self._event("RET", "RELEASE"),
            ],
            [self._event("RET", "PRESS"), self._event("RET", "RELEASE")],
        ]
        receipts = []
        previous = None
        for index, (operation_id, events) in enumerate(zip(OPERATIONS, event_sets), start=1):
            receipt = {
                "receiptId": str(uuid.uuid4()),
                "proofId": delivery["proofId"],
                "requestId": delivery["requestId"],
                "deliveryId": delivery["deliveryId"],
                "bindingContentSha256": delivery["bindingContentSha256"],
                "order": index,
                "previousReceiptContentSha256": previous,
                "outcome": "succeeded",
                "occurredAt": NOW,
                "operationId": operation_id,
                "kind": "operator_property_update" if index == 3 else "key_input",
                "eventEvidence": events,
            }
            if index in {1, 2, 4}:
                receipt.update(
                    {
                        "context": {
                            "windowId": "1",
                            "areaType": "VIEW_3D",
                            "regionType": "WINDOW",
                            "mode": "OBJECT",
                        },
                        "operatorStackBeforeSha256": "a" * 64,
                        "operatorStackAfterSha256": "b" * 64,
                    }
                )
            if index == 2:
                receipt.update(
                    {
                        "sourceOperationId": OPERATIONS[0],
                        "sourceOperatorId": "object.subdivision_set",
                    }
                )
            if index == 3:
                receipt.update(
                    {
                        "surfaceOperationId": OPERATIONS[1],
                        "surfaceOperatorId": "object.subdivision_set",
                        "controlId": "object.subdivision_set.level",
                        "oldValue": 1,
                        "newValue": 2,
                    }
                )
            if index == 4:
                receipt["surfaceOperationId"] = OPERATIONS[1]
            receipt["contentSha256"] = CompanionTransport._canonical_sha256(receipt)
            previous = receipt["contentSha256"]
            receipts.append(receipt)
        return receipts

    def _success_result(self, delivery: dict) -> dict:
        receipts = self._receipts(delivery)
        scene_fingerprint = "c" * 64
        strong = {
            "kind": "subdivision_surface_shortcut_ready",
            "satisfied": True,
            "observationId": str(uuid.uuid4()),
            "observedAt": NOW,
            "targetId": delivery["binding"]["acceptedAction"]["arguments"]["targetId"],
            "modifierType": "SUBSURF",
            "modifierCount": 1,
            "viewportLevel": 2,
            "subdivisionType": "CATMULL_CLARK",
            "renderLevels": 2,
            "quality": 3,
            "modifierStackMatches": True,
            "evaluatedTopologyWithinBounds": True,
            "sceneFingerprintSha256": scene_fingerprint,
        }
        strong["contentSha256"] = CompanionTransport._canonical_sha256(strong)
        checkpoint = {
            "formatVersion": "1.0.0",
            "evidenceClass": "companion_reported_shortcut_proof_native_undo_checkpoint",
            "checkpointId": str(uuid.uuid4()),
            "proofId": delivery["proofId"],
            "replayId": delivery["replayId"],
            "previousCheckpointId": None,
            "operation": "shortcut_proof",
            "undoLockId": str(uuid.uuid4()),
            "targetId": strong["targetId"],
            "marker": {
                "key": "_operating_line_shortcut_proof_history_v1",
                "matched": True,
            },
            "journal": {
                "entryPresent": True,
                "baselineSnapshotPresent": True,
                "finalSnapshotPresent": True,
                "undoRedoRoundTripVerified": True,
                "mutationLeaseHeld": True,
            },
            "baselineState": {
                "targetId": strong["targetId"],
                "modifierCount": 0,
                "activeObjectMode": "OBJECT",
                "selectedObjectCount": 1,
            },
            "finalState": {
                "targetId": strong["targetId"],
                "modifierType": "SUBSURF",
                "modifierCount": 1,
                "viewportLevel": 2,
            },
            "baselineSceneFingerprintSha256": "d" * 64,
            "finalSceneFingerprintSha256": scene_fingerprint,
            "receiptChainRootSha256": receipts[0]["contentSha256"],
            "receiptChainHeadSha256": receipts[-1]["contentSha256"],
            "strongObservationContentSha256": strong["contentSha256"],
            "committedAt": NOW,
        }
        attestation = {
            "formatVersion": "1.0.0",
            "attestationId": str(uuid.uuid4()),
            "deliveryId": delivery["deliveryId"],
            "binding": deepcopy(delivery["binding"]),
            "bindingContentSha256": delivery["bindingContentSha256"],
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "executor": {
                "executorId": delivery["executorId"],
                "executionBoundary": delivery["executionBoundary"],
                "transport": delivery["transport"],
                "osHidInput": False,
            },
            "operationReceipts": receipts,
            "strongObservation": strong,
            "nativeUndoCheckpoint": checkpoint,
            "attestedAt": NOW,
        }
        attestation["integrity"] = {
            "algorithm": "sha256",
            "canonicalization": "operatingline-json-value-v1",
            "contentSha256": CompanionTransport._canonical_sha256(attestation),
        }
        return {
            **deepcopy(delivery),
            "status": "succeeded",
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "requiresUndoToUnlock": True,
            "terminalEvidence": {"kind": "succeeded_locked", "attestation": attestation},
            "error": None,
            "occurredAt": NOW,
        }

    def _history_result(self, delivery: dict, success: dict, *, restored: bool) -> dict:
        checkpoint = success["terminalEvidence"]["attestation"]["nativeUndoCheckpoint"]
        current_fingerprint = (
            checkpoint["baselineSceneFingerprintSha256"]
            if restored
            else checkpoint["finalSceneFingerprintSha256"]
        )
        observation = {
            "satisfied": True,
            "restorationObservationId" if restored else "redoObservationId": str(uuid.uuid4()),
            "sceneFingerprintSha256": current_fingerprint,
        }
        observation["contentSha256"] = CompanionTransport._canonical_sha256(observation)
        status = "restored" if restored else "reapplied_locked"
        evidence = {
            "kind": status,
            "sourceCheckpointId": checkpoint["checkpointId"],
            "undoLockId": checkpoint["undoLockId"],
            "baselineSceneFingerprintSha256": checkpoint[
                "baselineSceneFingerprintSha256"
            ],
            "lockedSceneFingerprintSha256": checkpoint["finalSceneFingerprintSha256"],
            "currentSceneFingerprintSha256": current_fingerprint,
            "nativeUndoObservation" if restored else "nativeRedoObservation": observation,
            "restoredAt" if restored else "reappliedAt": NOW,
        }
        return {
            **deepcopy(delivery),
            "status": status,
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "requiresUndoToUnlock": not restored,
            "terminalEvidence": evidence,
            "error": None,
            "occurredAt": NOW,
        }

    def test_poll_validates_full_binding_and_deduplicates_without_reexecution(self) -> None:
        delivery = self._delivery()
        self.transport._request_json = lambda *_args, **_kwargs: {"request": delivery}

        self.transport._poll_shortcut_proof_request()
        self.transport._poll_shortcut_proof_request()

        self.assertEqual(
            self.transport.incoming.get_nowait(),
            {"kind": "shortcut_proof_execute_request", "request": delivery},
        )
        with self.assertRaises(Empty):
            self.transport.incoming.get_nowait()

    def test_poll_rejects_binding_hash_target_and_four_step_tampering(self) -> None:
        for mutate, message in (
            (lambda value: value["binding"]["acceptedAction"]["arguments"].update({"viewportLevel": 3}), "content hash"),
            (lambda value: value.update({"targetProfile": "arbitrary"}), "target profile"),
            (lambda value: value["operationIds"].reverse(), "immutable binding"),
        ):
            delivery = self._delivery()
            mutate(delivery)
            self.transport._request_json = lambda *_args, candidate=delivery, **_kwargs: {"request": candidate}
            with self.assertRaisesRegex(ValueError, message):
                self.transport._poll_shortcut_proof_request()

        wrong_resource = self._delivery()
        wrong_binding = wrong_resource["binding"]
        wrong_binding["acceptedAction"]["arguments"]["modifierName"] = "Subdivision"
        wrong_hash = CompanionTransport._canonical_sha256(
            {key: value for key, value in wrong_binding.items() if key != "integrity"}
        )
        wrong_binding["integrity"]["contentSha256"] = wrong_hash
        wrong_resource["bindingContentSha256"] = wrong_hash
        self.transport._request_json = lambda *_args, **_kwargs: {"request": wrong_resource}
        with self.assertRaisesRegex(ValueError, "resource identity"):
            self.transport._poll_shortcut_proof_request()

    def test_poll_routes_recovery_by_recovery_id_without_reexecuting_request(self) -> None:
        recovery = self._recovery_delivery()
        self.transport._request_json = lambda *_args, **_kwargs: {"request": recovery}

        self.transport._poll_shortcut_proof_request()
        self.transport._poll_shortcut_proof_request()

        self.assertEqual(
            self.transport.incoming.get_nowait(),
            {"kind": "shortcut_proof_recovery_request", "request": recovery},
        )
        with self.assertRaises(Empty):
            self.transport.incoming.get_nowait()

    def test_recovery_ack_requires_exact_locked_history_proof(self) -> None:
        recovery = self._recovery_delivery()
        ack = {
            key: deepcopy(recovery[key])
            for key in (
                "formatVersion", "requestId", "replayId", "proofId", "deliveryId",
                "target", "bindingContentSha256", "recoveryId", "history",
                "expectedMarkerContentSha256",
            )
        }
        ack.update(
            {
                "kind": "native_history_rebind",
                "currentSceneFingerprintSha256": recovery["history"][
                    "lockedSceneFingerprintSha256"
                ],
                "mutationLocked": True,
                "status": "succeeded",
                "occurredAt": NOW,
            }
        )

        self.transport.submit_shortcut_proof_recovery_ack(ack)
        self.assertEqual(self.transport.shortcut_proof_recovery_acks.get_nowait(), ack)

        invalid = deepcopy(ack)
        invalid["currentSceneFingerprintSha256"] = "9" * 64
        with self.assertRaisesRegex(ValueError, "fingerprint"):
            self.transport.submit_shortcut_proof_recovery_ack(invalid)

    def test_transition_reconciliation_ack_mirrors_protocol_ordering_contract(self) -> None:
        delivery = self._delivery()
        succeeded = self._success_result(delivery)
        restored = self._history_result(delivery, succeeded, restored=True)
        restored["occurredAt"] = "2026-08-20T12:00:01Z"
        reapplied = self._history_result(delivery, succeeded, restored=False)
        reapplied["occurredAt"] = "2026-08-20T12:00:02Z"
        ack = {
            "kind": "native_history_transition_reconcile",
            "recoveryId": str(uuid.uuid4()),
            "expectedResultContentSha256": CompanionTransport._canonical_sha256(
                succeeded
            ),
            "results": [restored, reapplied],
            "expectedMarkerContentSha256": "8" * 64,
            "currentSceneFingerprintSha256": reapplied["terminalEvidence"][
                "currentSceneFingerprintSha256"
            ],
            "occurredAt": "2026-08-20T12:00:03Z",
        }

        self.transport.submit_shortcut_proof_recovery_ack(ack)
        self.assertEqual(self.transport.shortcut_proof_recovery_acks.get_nowait(), ack)

        repeated_status = deepcopy(ack)
        repeated_status["results"][1] = deepcopy(restored)
        repeated_status["results"][1]["occurredAt"] = "2026-08-20T12:00:02Z"
        repeated_status["currentSceneFingerprintSha256"] = restored[
            "terminalEvidence"
        ]["currentSceneFingerprintSha256"]
        with self.assertRaisesRegex(ValueError, "strictly alternate"):
            self.transport.submit_shortcut_proof_recovery_ack(repeated_status)

        non_chronological = deepcopy(ack)
        non_chronological["results"][1]["occurredAt"] = restored["occurredAt"]
        with self.assertRaisesRegex(ValueError, "strictly chronological"):
            self.transport.submit_shortcut_proof_recovery_ack(non_chronological)

        wrong_final_fingerprint = deepcopy(ack)
        wrong_final_fingerprint["currentSceneFingerprintSha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "fingerprint"):
            self.transport.submit_shortcut_proof_recovery_ack(
                wrong_final_fingerprint
            )

        early_ack = deepcopy(ack)
        early_ack["occurredAt"] = "2026-08-20T12:00:01Z"
        with self.assertRaisesRegex(ValueError, "predates its final result"):
            self.transport.submit_shortcut_proof_recovery_ack(early_ack)

    def test_terminal_reconciliation_poll_and_ack_are_strict_union_members(self) -> None:
        delivery = self._delivery()
        result = self._success_result(delivery)
        receipts = result["terminalEvidence"]["attestation"]["operationReceipts"]
        challenge = {
            **deepcopy(delivery),
            "kind": "native_terminal_reconcile",
            "recoveryId": str(uuid.uuid4()),
            "acknowledgedProgressReceiptChainHeads": [
                receipt["contentSha256"] for receipt in receipts[:3]
            ],
            "recoveryRequestedAt": NOW,
        }
        self.transport._request_json = lambda *_args, **_kwargs: {"request": challenge}

        self.transport._poll_shortcut_proof_request()

        self.assertEqual(
            self.transport.incoming.get_nowait(),
            {"kind": "shortcut_proof_terminal_reconcile_request", "request": challenge},
        )
        checkpoint = result["terminalEvidence"]["attestation"]["nativeUndoCheckpoint"]
        marker = {
            "formatVersion": "1.0.0",
            "executorId": result["executorId"],
            "checkpointId": checkpoint["checkpointId"],
            "undoLockId": checkpoint["undoLockId"],
            "proofId": result["proofId"],
            "replayId": result["replayId"],
            "targetId": result["binding"]["acceptedAction"]["arguments"]["targetId"],
            "targetObjectName": "Cube",
            "checkpointKind": "success",
            "baselineSceneFingerprintSha256": checkpoint[
                "baselineSceneFingerprintSha256"
            ],
            "finalSceneFingerprintSha256": checkpoint["finalSceneFingerprintSha256"],
            "terminalResultContentSha256": CompanionTransport._canonical_sha256(result),
        }
        ack = {
            "kind": "native_terminal_reconcile",
            "recoveryId": challenge["recoveryId"],
            "result": result,
            "expectedMarkerContentSha256": CompanionTransport._canonical_sha256(marker),
            "currentSceneFingerprintSha256": checkpoint[
                "finalSceneFingerprintSha256"
            ],
            "occurredAt": NOW,
        }
        self.transport.submit_shortcut_proof_recovery_ack(ack)
        self.assertEqual(self.transport.shortcut_proof_recovery_acks.get_nowait(), ack)

        tampered = deepcopy(ack)
        tampered["result"]["terminalEvidence"]["attestation"]["nativeUndoCheckpoint"][
            "journal"
        ]["mutationLeaseHeld"] = False
        with self.assertRaisesRegex(ValueError, "nested evidence"):
            self.transport.submit_shortcut_proof_recovery_ack(tampered)

    def test_progress_and_result_use_independent_strict_queues(self) -> None:
        delivery = self._delivery()
        progress = {
            **deepcopy(delivery),
            "status": "in_progress",
            "completedOperationIds": OPERATIONS[:1],
            "receiptChainHeadSha256": "5" * 64,
            "occurredAt": NOW,
        }
        result = {
            **deepcopy(delivery),
            "status": "rejected",
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "requiresUndoToUnlock": False,
            "terminalEvidence": {"kind": "rejected_before_mutation", "mutationStarted": False},
            "error": "preflight rejected",
            "occurredAt": NOW,
        }

        self.transport.submit_shortcut_proof_progress(progress)
        self.transport.submit_shortcut_proof_result(result)

        self.assertEqual(self.transport.shortcut_proof_progress.get_nowait(), progress)
        self.assertEqual(self.transport.shortcut_proof_results.get_nowait(), result)
        invalid = deepcopy(progress)
        invalid["completedOperationIds"] = [OPERATIONS[1]]
        with self.assertRaisesRegex(ValueError, "exact operation prefix"):
            self.transport.submit_shortcut_proof_progress(invalid)

    def test_current_success_undo_and_redo_results_cross_the_transport_boundary(self) -> None:
        delivery = self._delivery()
        succeeded = self._success_result(delivery)
        restored = self._history_result(delivery, succeeded, restored=True)
        reapplied = self._history_result(delivery, succeeded, restored=False)

        for result in (succeeded, restored, reapplied):
            self.transport.submit_shortcut_proof_result(result)
            self.assertEqual(self.transport.shortcut_proof_results.get_nowait(), result)

        tampered = deepcopy(succeeded)
        receipt = tampered["terminalEvidence"]["attestation"]["operationReceipts"][0]
        receipt["deliveryId"] = str(uuid.uuid4())
        receipt_body = {key: value for key, value in receipt.items() if key != "contentSha256"}
        receipt["contentSha256"] = CompanionTransport._canonical_sha256(receipt_body)
        with self.assertRaisesRegex(ValueError, "delivery identity"):
            self.transport.submit_shortcut_proof_result(tampered)

    def test_background_drain_acknowledges_all_progress_before_terminal_result(self) -> None:
        delivery = self._delivery()
        succeeded = self._success_result(delivery)
        receipts = succeeded["terminalEvidence"]["attestation"]["operationReceipts"]
        calls = []

        def request_json(_method, path, body=None, **_kwargs):
            if path == "/api/v1/companion/session":
                return {
                    "contractVersion": "1.0.0",
                    "leaseId": str(uuid.uuid4()),
                    "negotiatedGuideProtocolVersion": domain.PROTOCOL_VERSION,
                    "catalogVersion": domain.BLENDER_ACTION_CATALOG_VERSION,
                    "capabilities": body["capabilities"],
                    "heartbeatIntervalMs": 60_000,
                    "leaseTtlMs": 120_000,
                    "expiresAt": "2099-01-01T00:00:00Z",
                }
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            if path == "/api/v1/companion/shortcut-proof-progress":
                calls.append((path, len(body["completedOperationIds"])))
                return {"result": "accepted"}
            if path == "/api/v1/companion/shortcut-proof-result":
                calls.append((path, body["status"]))
                return {"result": "accepted"}
            raise AssertionError(f"Unexpected request: {path}")

        self.transport._request_json = request_json
        self.transport._poll = lambda: None
        self.transport._establish_session()
        for index, receipt in enumerate(receipts, start=1):
            self.transport.submit_shortcut_proof_progress(
                {
                    **deepcopy(delivery),
                    "status": "in_progress",
                    "completedOperationIds": OPERATIONS[:index],
                    "receiptChainHeadSha256": receipt["contentSha256"],
                    "occurredAt": NOW,
                }
            )
        self.transport.submit_shortcut_proof_result(succeeded)

        self.transport.start()
        self.transport.stop(flush_timeout=0.5)
        self.assertTrue(self.transport.wait_stopped(1.0))
        self.assertEqual(
            calls,
            [
                ("/api/v1/companion/shortcut-proof-progress", 1),
                ("/api/v1/companion/shortcut-proof-progress", 2),
                ("/api/v1/companion/shortcut-proof-progress", 3),
                ("/api/v1/companion/shortcut-proof-progress", 4),
                ("/api/v1/companion/shortcut-proof-result", "succeeded"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
