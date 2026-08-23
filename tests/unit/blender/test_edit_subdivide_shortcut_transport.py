"""Strict transport tests for the Edit Subdivide shortcut executor profile."""

from __future__ import annotations

from copy import deepcopy
from importlib import import_module
from pathlib import Path
import sys
from types import ModuleType
import unittest
import uuid

REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_edit_subdivide_shortcut_transport_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
transport_module = import_module(f"{PACKAGE_NAME}.infrastructure.companion_transport")


NOW = "2026-08-20T12:00:00Z"
OPERATIONS = transport_module.EDIT_SUBDIVIDE_SHORTCUT_OPERATION_IDS


class EditSubdivideShortcutTransportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.instance_id = str(uuid.uuid4())
        self.transport = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            self.instance_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
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
            "plan": {"id": "plan", "revision": 1, "contentSha256": "2" * 64},
            "executionId": str(uuid.uuid4()),
            "leafId": "leaf.subdivide",
            "recipeId": "blender.mesh.edit_subdivide.semantic",
            "actionName": "blender.mesh.edit_subdivide",
            "acceptedAction": {
                "adapterId": "blender",
                "name": "blender.mesh.edit_subdivide",
                "arguments": {
                    "targetId": "tutorial.cube",
                    "resultMeshId": "tutorial.cube.mesh",
                    "resultMeshName": "Cube",
                    "cuts": 2,
                    "smooth": 0.5,
                },
            },
            "targetProfile": "factory_cube_single_user_mesh_8_12_6",
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
                "managedReplacementMeshCreated": False,
                "nativeMutationKind": "in_place_edit_mesh_subdivide",
                "omittedAcceptedArguments": [
                    "targetId",
                    "resultMeshId",
                    "resultMeshName",
                ],
            },
            "materialization": {
                "actionCatalogVersion": "1.0.0",
                "interactionCatalogVersion": "1.44.0",
                "interactionCatalogContentSha256": "3" * 64,
                "shortcutTrackContentSha256": "4" * 64,
            },
            "executorId": transport_module.EDIT_SUBDIVIDE_SHORTCUT_EXECUTOR_ID,
            "executionBoundary": "blender_window_event_simulate",
            "authorization": "accepted_replay_next_step",
            "transport": "event_simulate",
            "operationIds": list(OPERATIONS),
            "nativeUndoDepth": 4,
            "nativeRedoDepth": 4,
            "startState": {"reportId": str(uuid.uuid4()), "sequence": 7},
            "createdAt": NOW,
        }
        binding["integrity"] = {
            "algorithm": "sha256",
            "canonicalization": "operatingline-json-value-v1",
            "contentSha256": self.transport._canonical_sha256(binding),
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
            "interactionCatalogVersion": binding["materialization"][
                "interactionCatalogVersion"
            ],
            "interactionCatalogContentSha256": binding["materialization"][
                "interactionCatalogContentSha256"
            ],
            "shortcutTrackContentSha256": binding["materialization"][
                "shortcutTrackContentSha256"
            ],
            "bindingContentSha256": binding["integrity"]["contentSha256"],
            "binding": binding,
            "executorId": binding["executorId"],
            "executionBoundary": binding["executionBoundary"],
            "authorization": binding["authorization"],
            "transport": binding["transport"],
            "operationIds": list(OPERATIONS),
            "nativeUndoDepth": 4,
            "nativeRedoDepth": 4,
            "expectedState": deepcopy(binding["startState"]),
            "requestedAt": NOW,
            "dispatchedAt": NOW,
        }

    def test_accepts_exact_edit_subdivide_delivery(self) -> None:
        delivery = self._delivery()
        self.assertEqual(
            self.transport._validate_shortcut_proof_delivery(delivery), delivery
        )

    def test_rejects_depth_downgrade_and_unknown_binding_field(self) -> None:
        delivery = self._delivery()
        delivery["nativeUndoDepth"] = 1
        with self.assertRaisesRegex(ValueError, "executor identity"):
            self.transport._validate_shortcut_proof_delivery(delivery)
        binding = self._binding()
        binding["untrustedEvents"] = []
        with self.assertRaisesRegex(ValueError, "unexpected untrustedEvents"):
            self.transport._validate_shortcut_proof_binding(binding)

    def test_poll_queues_v2_native_history_recovery(self) -> None:
        delivery = self._delivery()
        delivery.update(
            {
                "kind": "native_history_rebind",
                "recoveryId": str(uuid.uuid4()),
                "history": {
                    "checkpointId": str(uuid.uuid4()),
                    "undoLockId": str(uuid.uuid4()),
                    "checkpointKind": "success",
                    "baselineSceneFingerprintSha256": "5" * 64,
                    "lockedSceneFingerprintSha256": "6" * 64,
                    "terminalResultContentSha256": "7" * 64,
                },
                "expectedMarkerContentSha256": "8" * 64,
                "expectedResultContentSha256": "7" * 64,
                "expectedStatus": "succeeded",
                "recoveryRequestedAt": NOW,
            }
        )
        self.transport._request_json = lambda *_args, **_kwargs: {"request": delivery}
        self.transport._poll_shortcut_proof_request()
        queued = self.transport.incoming.get_nowait()
        self.assertEqual(queued["kind"], "shortcut_proof_recovery_request")
        self.assertEqual(queued["request"], delivery)


if __name__ == "__main__":
    unittest.main()
