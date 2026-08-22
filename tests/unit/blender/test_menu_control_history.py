"""Hostile pure-Python tests for nine-stage menu-control native history."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from importlib import import_module
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
import uuid


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_menu_control_history_test"


class _Scene(dict):
    def __init__(self, session_uid: int) -> None:
        super().__init__()
        self.session_uid = session_uid


class _CorruptingScene(_Scene):
    corrupt_next_write = False

    def __setitem__(self, key, value):
        if self.corrupt_next_write and key == "_operating_line_menu_control_history_v1":
            self.corrupt_next_write = False
            value = "{corrupt"
        super().__setitem__(key, value)


handlers = SimpleNamespace(undo_post=[], redo_post=[], load_post=[])


def _persistent(callback):
    callback._is_persistent = True
    return callback


fake_bpy = ModuleType("bpy")
fake_bpy.app = SimpleNamespace(handlers=handlers, timers=SimpleNamespace())
fake_bpy.context = SimpleNamespace()
fake_bpy.data = SimpleNamespace(scenes=[])
sys.modules["bpy"] = fake_bpy
fake_bpy_app = ModuleType("bpy.app")
fake_bpy_app.handlers = handlers
fake_bpy_handlers = ModuleType("bpy.app.handlers")
fake_bpy_handlers.persistent = _persistent
sys.modules["bpy.app"] = fake_bpy_app
sys.modules["bpy.app.handlers"] = fake_bpy_handlers

operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
proof = import_module(f"{PACKAGE_NAME}.infrastructure.menu_control_proof")
history = import_module(f"{PACKAGE_NAME}.infrastructure.menu_control_history")


PROOF_ID = "00000000-0000-4000-8000-000000000101"
REPLAY_ID = "00000000-0000-4000-8000-000000000102"
INSTANCE_ID = "00000000-0000-4000-8000-000000000103"
LEASE_ID = "00000000-0000-4000-8000-000000000104"
CANONICAL_HASH_VECTOR = {
    "10": "ten", "2": "two", "é": "accent", "😀": "emoji",
    "text": "hello 😀", "small": 1e-7, "large": 1e20, "zero": -0.0,
}
CANONICAL_HASH_VECTOR_SHA256 = "53034233732c02e4a0058220b140da17c9fe8242f55c9455bdb7724529980149"
_BASELINE_SCENE = {"state": "factory_baseline"}
_FINAL_SCENE = {"state": "uv_sphere_final"}
_STAGE_SCENES = tuple(
    _BASELINE_SCENE if index == 0 else _FINAL_SCENE if index == 8 else {"state": f"stage_{index}"}
    for index in range(9)
)


def _fingerprint(cursor: int) -> str:
    return proof.compute_scene_fingerprint_sha256(_STAGE_SCENES[cursor])


def _snapshot(label: str, cursor: int) -> dict[str, object]:
    name, location, scale = history._stage_snapshot_values(cursor)
    return {
        "label": label,
        "objectNames": ["Camera", "Cube", "Light"] if cursor == 0 else sorted(["Camera", "Cube", "Light", str(name)]),
        "activeObject": "Cube" if cursor == 0 else name,
        "proofObjectName": name,
        "proofObjectLocation": location,
        "proofObjectScale": scale,
        "proofMeshTopology": None if cursor == 0 else proof.EXPECTED_TOPOLOGY,
        "sceneSnapshot": deepcopy(_STAGE_SCENES[cursor]),
        "sceneFingerprintSha256": _fingerprint(cursor),
    }


def _success_evidence() -> dict[str, object]:
    snapshots = [_snapshot("final", 8)]
    snapshots.extend(_snapshot(f"undo-{index}", 8 - index) for index in range(1, 9))
    snapshots.extend(_snapshot(f"redo-{index}", index) for index in range(1, 9))
    return {
        "ok": True,
        "proofFormatVersion": "1.0.0",
        "executorId": proof.EXECUTOR_ID,
        "targetProfile": proof.TARGET_PROFILE,
        "executionBoundary": "blender_window_event_simulate",
        "transport": "event_simulate",
        **proof.execution_evidence_claims(),
        "managedActionExecuted": False,
        "managedReceiptCreated": False,
        "authorization": "accepted_replay_next_step",
        "eventSimulateCount": 146,
        "menuControlExecutionVerified": True,
        "strongCurrentStateVerified": True,
        "nativeUndoCheckpointRequired": True,
        "hostVersion": "4.5.3",
        "uiScale": 2.0,
        "sourceOperator": {
            "id": "MESH_OT_primitive_uv_sphere_add", "segments": 32,
            "ringCount": 16, "radius": 1.0, "location": [0.0, 0.0, 0.0],
        },
        "finalState": {
            "objectName": "OperatingLine.TutorialEye", "objectType": "MESH",
            "location": [1.25, -2.0, 0.75], "scale": [1.5, 1.5, 1.5],
            "meshTopology": dict(proof.EXPECTED_TOPOLOGY), "meshSha256": "a" * 64,
        },
        "eventSequenceSha256": "b" * 64,
        "operationIds": list(proof.OPERATION_IDS),
        "acceptedAction": {
            "name": "blender.mesh.create_uv_sphere",
            "arguments": proof.expected_arguments_payload(),
        },
        "nativeUndoDepth": 8,
        "strongObservationKind": "uv_sphere_menu_controls_ready",
        "nativeUndoCheckpointVerified": True,
        "operationSummaries": [
            {
                "operationId": operation_id,
                "status": "precondition_verified" if index == 0 else "control_executed",
                "path": (
                    ["Layout"], ["Layout", "Add"], ["Layout", "Add", "Mesh"],
                    ["Layout", "Add", "Mesh", "UV Sphere"],
                    ["Sidebar", "Item", "Transform", "Location"],
                    ["Sidebar", "Item", "Transform", "Scale"],
                    ["Properties", "Object", "Name"],
                )[index],
                "parameters": (
                    {}, {}, {}, {"radius": 1.0}, {"value": [1.25, -2.0, 0.75]},
                    {"value": [1.5, 1.5, 1.5]},
                    {"value": "OperatingLine.TutorialEye"},
                )[index],
            }
            for index, operation_id in enumerate(proof.OPERATION_IDS)
        ],
        "historySnapshots": snapshots,
        "baselineSceneFingerprintSha256": _fingerprint(0),
        "finalSceneFingerprintSha256": _fingerprint(8),
        "restoredSceneFingerprintSha256": _fingerprint(0),
        "reappliedSceneFingerprintSha256": _fingerprint(8),
        "baselineSceneSnapshot": deepcopy(_BASELINE_SCENE),
        "finalSceneSnapshot": deepcopy(_FINAL_SCENE),
    }


def _terminal(status: str = "succeeded"):
    def build(checkpoint: dict[str, object]) -> dict[str, object]:
        checkpoint_key = (
            "nativeUndoCheckpoint" if status == "succeeded" else "checkpoint"
        )
        return {
            "formatVersion": "1.0.0",
            "proofId": PROOF_ID,
            "replayId": REPLAY_ID,
            "status": status,
            "terminalEvidence": {
                "kind": "menu_control_" + status,
                checkpoint_key: {
                    "checkpointId": checkpoint["checkpointId"],
                    "undoLockId": checkpoint["undoLockId"],
                },
            },
        }
    return build


def _authority(marker, scene, gate, **kwargs):
    return gate.issue(
        marker,
        scene_session_uid=scene.session_uid,
        instance_id=kwargs.get("instance_id", INSTANCE_ID),
        lease_id=kwargs.get("lease_id", LEASE_ID),
        ttl_seconds=kwargs.get("ttl_seconds", 60),
    )


class MenuControlHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        handlers.undo_post.clear()
        handlers.redo_post.clear()
        handlers.load_post.clear()
        history._REGISTERED_CONTROLLERS.clear()
        self.scene = _Scene(17)
        fake_bpy.data.scenes = [self.scene]
        fake_bpy.context.scene = self.scene
        self.now = datetime(2026, 8, 22, tzinfo=timezone.utc)
        self.gate = history.HmacRebindAuthorityGate(
            b"menu-history-test-secret-material-32-bytes!",
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
            now=lambda: self.now,
        )
        self.live = _fingerprint(8)
        history._live_scene_fingerprint = lambda _scene: self.live
        self.controller = history.MenuControlHistoryController(self.gate)

    def _arm(self) -> dict[str, object]:
        self.controller.register()
        return self.controller.arm(
            self.scene,
            _success_evidence(),
            proof_id=PROOF_ID,
            replay_id=REPLAY_ID,
            target_id="proof.uv_sphere.eye",
            terminal_result_builder=_terminal(),
        )

    def test_canonical_hash_matches_shared_protocol_vector(self) -> None:
        self.assertEqual(history._canonical_sha256(CANONICAL_HASH_VECTOR), CANONICAL_HASH_VECTOR_SHA256)

    def test_driver_result_derives_exact_nine_cursor_fingerprints(self) -> None:
        self.assertEqual(history.validate_driver_history_result(_success_evidence()), tuple(_fingerprint(index) for index in range(9)))

    def test_driver_result_rejects_stage_replacement_and_logical_mutation_conflation(self) -> None:
        evidence = _success_evidence()
        evidence["historySnapshots"][10] = _snapshot("redo-2", 3)
        with self.assertRaisesRegex(ValueError, "replacement|disagree"):
            history.validate_driver_history_result(evidence)

        evidence = _success_evidence()
        evidence["operationSummaries"].append({"operationId": "mutation.rename"})
        with self.assertRaisesRegex(ValueError, "seven ordered logical"):
            history.validate_driver_history_result(evidence)

    def test_driver_result_rejects_fixed_claim_argument_count_and_snapshot_tampering(self) -> None:
        mutations = (
            lambda value: value.update({"targetProfile": "arbitrary"}),
            lambda value: value.update({"eventSimulateCount": 145}),
            lambda value: value["acceptedAction"]["arguments"].update({"radius": 2.0}),
            lambda value: value["finalSceneSnapshot"].update({"state": "forged"}),
            lambda value: value.update({"managedActionExecuted": True}),
        )
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                evidence = _success_evidence()
                mutate(evidence)
                with self.assertRaises(ValueError):
                    history.validate_driver_history_result(evidence)

    def test_arm_is_final_locked_and_each_adjacent_undo_moves_one_cursor(self) -> None:
        checkpoint = self._arm()
        self.assertEqual(checkpoint["cursor"], 8)
        self.assertTrue(self.controller.mutation_locked)
        marker = json.loads(self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY])
        self.assertEqual(
            checkpoint["checkpointContentSha256"],
            marker["checkpointContentSha256"],
        )

        for expected_cursor in range(7, -1, -1):
            self.live = _fingerprint(expected_cursor)
            self.controller.sync("undo")
            self.assertEqual(self.controller.cursor, expected_cursor)
            self.assertEqual(self.controller.mutation_locked, expected_cursor != 0)
        self.assertEqual(self.controller.status, "restored")

    def test_terminal_outbox_reconciliation_is_read_only_and_acknowledged_durably(
        self,
    ) -> None:
        request_id = str(uuid.uuid4())
        delivery_id = str(uuid.uuid4())
        receipt_hash = "c" * 64

        def terminal_builder(checkpoint: dict[str, object]) -> dict[str, object]:
            return {
                "formatVersion": "1.0.0",
                "requestId": request_id,
                "replayId": REPLAY_ID,
                "proofId": PROOF_ID,
                "deliveryId": delivery_id,
                "target": {"adapterId": "blender", "instanceId": INSTANCE_ID},
                "lease": {"leaseId": LEASE_ID},
                "status": "succeeded",
                "managedActionResult": "not_executed",
                "managedIdentityVerified": False,
                "managedReceiptCreated": False,
                "requiresUndoToUnlock": True,
                "terminalEvidence": {
                    "kind": "succeeded_locked",
                    "operationReceipts": [{"contentSha256": receipt_hash}],
                    "nativeUndoCheckpoint": {
                        "checkpointId": checkpoint["checkpointId"],
                        "undoLockId": checkpoint["undoLockId"],
                        "finalSceneFingerprintSha256": _fingerprint(8),
                    },
                },
                "error": None,
                "occurredAt": "2020-01-01T00:00:00Z",
            }

        self.controller.register()
        self.controller.arm(
            self.scene,
            _success_evidence(),
            proof_id=PROOF_ID,
            replay_id=REPLAY_ID,
            target_id="proof.uv_sphere.eye",
            terminal_result_builder=terminal_builder,
        )
        pending = self.controller.pending_terminal_result()
        self.assertIsNotNone(pending)
        challenge = {
            **{
                key: deepcopy(value)
                for key, value in pending.items()
                if key
                not in {
                    "status",
                    "managedActionResult",
                    "managedIdentityVerified",
                    "managedReceiptCreated",
                    "requiresUndoToUnlock",
                    "terminalEvidence",
                    "error",
                    "occurredAt",
                }
            },
            "kind": "native_terminal_reconcile",
            "recoveryId": str(uuid.uuid4()),
            "acknowledgedProgressReceiptChainHeads": [receipt_hash],
            "recoveryRequestedAt": "2020-01-01T00:00:01Z",
        }

        ack = self.controller.build_terminal_reconciliation_ack(
            self.scene, challenge
        )

        self.assertEqual(ack["result"], pending)
        self.assertEqual(ack["currentSceneFingerprintSha256"], _fingerprint(8))
        self.assertEqual(
            ack["terminalResultContentSha256"], history._canonical_sha256(pending)
        )
        self.assertTrue(
            self.controller.acknowledge_terminal_result(
                ack["terminalResultContentSha256"]
            )
        )
        self.assertIsNone(self.controller.pending_terminal_result())
        marker = history.MenuControlHistoryController._read_marker(self.scene)
        self.assertEqual(
            marker["acknowledgedTerminalResultContentSha256"],
            ack["terminalResultContentSha256"],
        )

        marker["acknowledgedTerminalResultContentSha256"] = "d" * 64
        marker["markerContentSha256"] = history._canonical_sha256(
            history.MenuControlHistoryController._marker_identity(marker)
        )
        self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY] = json.dumps(marker)
        with self.assertRaisesRegex(RuntimeError, "acknowledgement identity"):
            history.MenuControlHistoryController._read_marker(self.scene)

    def test_each_adjacent_redo_relocks_and_moves_one_cursor(self) -> None:
        self._arm()
        for cursor in range(7, -1, -1):
            self.live = _fingerprint(cursor)
            self.controller.sync("undo")
        for expected_cursor in range(1, 9):
            self.live = _fingerprint(expected_cursor)
            self.controller.sync("redo")
            self.assertEqual(self.controller.cursor, expected_cursor)
            self.assertTrue(self.controller.mutation_locked)
        self.assertEqual(self.controller.status, "history_locked")

    def test_skipped_undo_or_wrong_direction_fails_closed_without_cursor_change(self) -> None:
        self._arm()
        self.live = _fingerprint(6)
        self.controller.sync("undo")
        self.assertEqual(self.controller.cursor, 8)
        self.assertTrue(self.controller.mutation_locked)
        self.assertEqual(self.controller.status, "recovery_required")

        other = history.MenuControlHistoryController()
        fake_bpy.data.scenes = []
        other.register()
        other._current = self.controller._entries[0]
        other._entries.append(self.controller._entries[0])
        other._locked = True
        self.live = _fingerprint(7)
        other.sync("redo")
        self.assertEqual(other.status, "recovery_required")

    def test_marker_and_terminal_outbox_tampering_are_rejected(self) -> None:
        self._arm()
        marker = json.loads(self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY])
        marker["cursor"] = 7
        self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY] = json.dumps(marker)
        with self.assertRaisesRegex(RuntimeError, "content hash"):
            history.MenuControlHistoryController._read_marker(self.scene)

        self._arm_fresh_after_reset()
        marker = json.loads(self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY])
        marker["terminalResult"]["status"] = "forged"
        marker["markerContentSha256"] = history._canonical_sha256(
            history.MenuControlHistoryController._marker_identity(marker)
        )
        self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY] = json.dumps(marker)
        with self.assertRaisesRegex(RuntimeError, "terminal outbox"):
            history.MenuControlHistoryController._read_marker(self.scene)

    def _arm_fresh_after_reset(self) -> None:
        self.scene.clear()
        fake_bpy.data.scenes = [self.scene]
        self.controller = history.MenuControlHistoryController(self.gate)
        self.live = _fingerprint(8)
        self._arm()

    def test_transition_outbox_tampering_and_wrong_acknowledgement_fail_closed(self) -> None:
        self._arm()
        self.live = _fingerprint(7)
        self.controller.sync("undo")
        checkpoint = self.controller.current_checkpoint()
        self.assertTrue(self.controller.has_transition_outbox())
        self.controller.acknowledge_transition_results(["f" * 64])
        self.assertEqual(self.controller.current_checkpoint()["transitionResultContentSha256s"], checkpoint["transitionResultContentSha256s"])

        marker = json.loads(self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY])
        marker["transitionResults"][0]["toCursor"] = 3
        marker["transitionResultContentSha256s"][0] = history._canonical_sha256(
            marker["transitionResults"][0]
        )
        marker["markerContentSha256"] = history._canonical_sha256(history.MenuControlHistoryController._marker_identity(marker))
        self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY] = json.dumps(marker)
        with self.assertRaisesRegex(RuntimeError, "transition order"):
            history.MenuControlHistoryController._read_marker(self.scene)

    def test_transition_outbox_persists_before_publish_and_callback_failure_fails_closed(self) -> None:
        published = []

        def publish(result):
            marker = json.loads(
                self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY]
            )
            self.assertEqual(marker["transitionResults"][-1], result)
            published.append(deepcopy(result))
            raise RuntimeError("injected menu transition publish failure")

        self.controller = history.MenuControlHistoryController(
            self.gate, transition_result_callback=publish
        )
        self._arm()
        self.live = _fingerprint(7)

        self.controller.sync("undo")

        marker = history.MenuControlHistoryController._read_marker(self.scene)
        self.assertEqual(marker["transitionResults"], published)
        self.assertEqual(marker["cursor"], 7)
        self.assertTrue(self.controller.has_transition_outbox())
        self.assertTrue(self.controller.mutation_locked)
        self.assertEqual(self.controller.status, "recovery_required")
        self.assertIn("publish failure", self.controller.error)

    def test_pending_transition_commitments_and_reconciliation_are_read_only(self) -> None:
        self._arm()
        self.live = _fingerprint(7)
        self.controller.sync("undo")
        self.live = _fingerprint(6)
        self.controller.sync("undo")
        pending = self.controller.pending_transition_results()
        marker_before = self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY]
        first_hash, second_hash = self.controller.current_checkpoint()[
            "transitionResultContentSha256s"
        ]
        commitments = self.controller.current_marker_commitments(self.scene)
        challenge = {
            "kind": "native_history_transition_reconcile",
            "recoveryId": str(uuid.uuid4()),
            "history": {
                "checkpointId": commitments["checkpointId"],
                "undoLockId": commitments["undoLockId"],
                "checkpointKind": commitments["checkpointKind"],
                "baselineSceneFingerprintSha256": commitments[
                    "stageFingerprints"
                ][0],
                "lockedSceneFingerprintSha256": commitments[
                    "stageFingerprints"
                ][8],
                "terminalResultContentSha256": commitments[
                    "terminalResultContentSha256"
                ],
                "terminalMarkerContentSha256": commitments[
                    "terminalMarkerContentSha256"
                ],
            },
            "serverAcceptedCursor": 7,
            "serverAcceptedStatus": "history_locked",
            "acknowledgedTransitionContentSha256s": [first_hash],
            "expectedMarkerContentSha256": commitments[
                "terminalMarkerContentSha256"
            ],
        }
        self.controller.acknowledge_transition_results([first_hash])

        ack = self.controller.reconcile_transition_outbox(self.scene, challenge)

        self.assertEqual(
            ack["kind"], "native_history_transition_reconcile"
        )
        self.assertEqual(ack["transitions"], pending[1:])
        self.assertEqual(ack["transitionContentSha256s"], [second_hash])
        self.assertEqual(ack["currentCursor"], 6)
        self.assertEqual(ack["currentStatus"], "history_locked")
        self.assertNotEqual(
            self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY], marker_before
        )
        pending[0]["status"] = "forged"
        self.assertNotEqual(
            pending, self.controller.pending_transition_results()
        )

        self.controller.acknowledge_transition_results([second_hash])
        self.assertEqual(
            self.controller.current_checkpoint()[
                "transitionResultContentSha256s"
            ],
            [],
        )
        self.assertEqual(self.controller.pending_transition_results(), [])

    def test_failure_checkpoint_native_undo_and_redo_use_null_cursor_boundary(self) -> None:
        published = []
        self.controller = history.MenuControlHistoryController(
            self.gate, transition_result_callback=published.append
        )
        self.controller.register()
        failed_snapshot = {"failure": "current"}
        failed_fingerprint = proof.compute_scene_fingerprint_sha256(
            failed_snapshot
        )
        self.live = failed_fingerprint
        evidence = {
            "ok": False,
            "executorId": proof.EXECUTOR_ID,
            "mutationStarted": True,
            "requiresUndoRecovery": True,
            "failureStatus": "failed_checkpointed",
            "baselineSceneFingerprintSha256": _fingerprint(0),
            "currentSceneFingerprintSha256": failed_fingerprint,
            "baselineSceneSnapshot": deepcopy(_BASELINE_SCENE),
            "currentSceneSnapshot": failed_snapshot,
        }
        self.controller.arm_failed(
            self.scene,
            evidence,
            proof_id=PROOF_ID,
            replay_id=REPLAY_ID,
            target_id="proof.uv_sphere.eye",
            terminal_result_builder=_terminal("failed_checkpointed"),
        )

        self.live = _fingerprint(0)
        self.controller.sync("undo")
        self.assertEqual(self.controller.cursor, 0)
        self.assertFalse(self.controller.mutation_locked)
        self.assertEqual(
            (published[-1]["fromCursor"], published[-1]["toCursor"]),
            (None, 0),
        )

        self.live = failed_fingerprint
        self.controller.sync("redo")
        self.assertIsNone(self.controller.cursor)
        self.assertTrue(self.controller.mutation_locked)
        self.assertEqual(
            (published[-1]["fromCursor"], published[-1]["toCursor"]),
            (0, None),
        )
        marker = history.MenuControlHistoryController._read_marker(self.scene)
        self.assertEqual(marker["cursor"], None)
        self.assertEqual(len(marker["transitionResults"]), 2)

    def test_failure_checkpoint_wrong_null_cursor_jump_requires_recovery(self) -> None:
        self.controller.register()
        failed_snapshot = {"failure": "current"}
        failed_fingerprint = proof.compute_scene_fingerprint_sha256(
            failed_snapshot
        )
        self.live = failed_fingerprint
        self.controller.arm_failed(
            self.scene,
            {
                "ok": False,
                "executorId": proof.EXECUTOR_ID,
                "mutationStarted": True,
                "requiresUndoRecovery": True,
                "failureStatus": "failed_checkpointed",
                "baselineSceneFingerprintSha256": _fingerprint(0),
                "currentSceneFingerprintSha256": failed_fingerprint,
                "baselineSceneSnapshot": deepcopy(_BASELINE_SCENE),
                "currentSceneSnapshot": failed_snapshot,
            },
            proof_id=PROOF_ID,
            replay_id=REPLAY_ID,
            target_id="proof.uv_sphere.eye",
            terminal_result_builder=_terminal("failed_checkpointed"),
        )
        marker_before = self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY]
        self.live = _fingerprint(2)

        self.controller.sync("undo")

        self.assertEqual(self.controller.status, "recovery_required")
        self.assertEqual(
            self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY], marker_before
        )

    def test_restart_load_requires_rebind_and_does_not_restore_instance_or_lease(self) -> None:
        self._arm()
        marker = json.loads(self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY])
        self.assertNotIn("instanceId", marker)
        self.assertNotIn("leaseId", marker)

        restarted = history.MenuControlHistoryController(self.gate)
        restarted.register()
        self.assertTrue(restarted.mutation_locked)
        self.assertEqual(restarted.status, "recovery_required")
        self.assertIsNone(restarted.cursor)
        rebound = restarted.rebind_orphan(
            self.scene,
            _authority(marker, self.scene, self.gate),
        )
        self.assertEqual(rebound["instanceId"], INSTANCE_ID)
        self.assertEqual(rebound["leaseId"], LEASE_ID)
        self.assertEqual(restarted.cursor, 8)

    def test_copied_marker_is_evidence_only_and_requires_live_stage_match(self) -> None:
        self._arm()
        copied = _Scene(99)
        copied.update(self.scene)
        fake_bpy.data.scenes = [copied]
        fake_bpy.context.scene = copied
        restarted = history.MenuControlHistoryController(self.gate)
        restarted.register()
        self.live = _fingerprint(7)
        marker = json.loads(copied[history.MENU_CONTROL_HISTORY_MARKER_KEY])
        with self.assertRaisesRegex(ValueError, "live stage"):
            restarted.rebind_orphan(copied, _authority(marker, copied, self.gate))
        self.assertEqual(restarted.status, "recovery_required")

    def test_failure_checkpoint_and_abandon_restore_paths_fail_closed(self) -> None:
        self.controller.register()
        current_snapshot = {"failure": "uncertain"}
        self.live = proof.compute_scene_fingerprint_sha256(current_snapshot)
        evidence = {
            "ok": False,
            "executorId": proof.EXECUTOR_ID,
            "mutationStarted": True,
            "requiresUndoRecovery": True,
            "failureStatus": "failed_checkpointed",
            "baselineSceneFingerprintSha256": _fingerprint(0),
            "currentSceneFingerprintSha256": self.live,
            "baselineSceneSnapshot": deepcopy(_BASELINE_SCENE),
            "currentSceneSnapshot": current_snapshot,
        }
        checkpoint = self.controller.arm_failed(
            self.scene, evidence, proof_id=PROOF_ID, replay_id=REPLAY_ID,
            target_id="proof.uv_sphere.eye",
            terminal_result_builder=_terminal("failed_checkpointed"),
        )
        self.assertIsNone(checkpoint["cursor"])
        self.assertTrue(self.controller.mutation_locked)
        self.assertTrue(self.controller.abandon())
        self.assertEqual(self.controller.status, "recovery_required")
        self.assertFalse(self.controller.confirm_restored())

    def test_confirm_restored_requires_exact_baseline(self) -> None:
        self._arm()
        self.live = _fingerprint(6)
        self.assertFalse(self.controller.confirm_restored())
        self.assertEqual(self.controller.status, "recovery_required")

    def test_production_controller_accepts_no_cursor_or_fingerprint_policy(self) -> None:
        with self.assertRaises(TypeError):
            history.MenuControlHistoryController(cursor=8)
        with self.assertRaises(TypeError):
            history.MenuControlHistoryController(fingerprint_reader=lambda: "f" * 64)
        source = Path(history.__file__).read_text(encoding="utf-8")
        self.assertNotIn("bpy.ops", source)

    def test_idle_native_undo_is_noop(self) -> None:
        self.controller.register()
        self.controller.sync("undo")
        self.assertEqual(self.controller.status, "idle")
        self.assertFalse(self.controller.mutation_locked)

    def test_handlers_are_module_level_persistent_and_load_discovers_marker(self) -> None:
        self._arm()
        self.assertIs(handlers.undo_post[0], history._menu_control_undo_post)
        self.assertTrue(history._menu_control_undo_post._is_persistent)
        self.assertTrue(history._menu_control_redo_post._is_persistent)
        self.assertTrue(history._menu_control_load_post._is_persistent)
        history._menu_control_load_post(None)
        self.assertEqual(self.controller.status, "recovery_required")
        self.assertIsNone(self.controller.cursor)

    def test_unregister_cannot_stop_locked_or_recovery_tracking(self) -> None:
        self._arm()
        self.assertFalse(self.controller.unregister())
        self.assertTrue(self.controller.registered)
        self.assertIn(self.controller, history._REGISTERED_CONTROLLERS)
        self.assertIn(history._menu_control_undo_post, handlers.undo_post)
        self.controller.loaded_file()
        self.assertFalse(self.controller.unregister())
        self.assertIn(history._menu_control_load_post, handlers.load_post)

    def test_retire_hands_load_handlers_to_one_replacement_controller(self) -> None:
        self._arm()
        self.controller.retire(keep_handlers=True)
        self.assertNotIn(self.controller, history._REGISTERED_CONTROLLERS)
        self.assertIn(history._menu_control_load_post, handlers.load_post)
        self.assertEqual(self.controller.status, "retired")

        replacement = history.MenuControlHistoryController(self.gate)
        replacement.register()
        self.assertEqual(history._REGISTERED_CONTROLLERS, {replacement})
        self.assertEqual(replacement.status, "recovery_required")
        replacement.retire()
        self.assertEqual(history._REGISTERED_CONTROLLERS, set())
        self.assertNotIn(history._menu_control_load_post, handlers.load_post)

    def test_scene_binding_rejects_non_context_or_unregistered_scene(self) -> None:
        self.controller.register()
        other = _Scene(44)
        with self.assertRaisesRegex(ValueError, "current registered Scene"):
            self.controller.arm(
                other, _success_evidence(), proof_id=PROOF_ID, replay_id=REPLAY_ID,
                target_id="proof.uv_sphere.eye", terminal_result_builder=_terminal(),
            )

    def test_terminal_builder_identity_mismatch_is_rejected_before_marker_write(self) -> None:
        mutations = (
            lambda result: result.update({"proofId": str(uuid.uuid4())}),
            lambda result: result.update({"replayId": str(uuid.uuid4())}),
            lambda result: result.update({"status": "restored"}),
            lambda result: result["terminalEvidence"]["nativeUndoCheckpoint"].update(
                {"checkpointId": str(uuid.uuid4())}
            ),
            lambda result: result["terminalEvidence"]["nativeUndoCheckpoint"].update(
                {"undoLockId": str(uuid.uuid4())}
            ),
        )
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                self.scene.clear()
                self.controller = history.MenuControlHistoryController(self.gate)
                self.controller.register()

                def forged(checkpoint, mutate=mutate):
                    result = _terminal()(checkpoint)
                    mutate(result)
                    return result

                with self.assertRaisesRegex(ValueError, "terminal result identity"):
                    self.controller.arm(
                        self.scene, _success_evidence(), proof_id=PROOF_ID,
                        replay_id=REPLAY_ID, target_id="proof.uv_sphere.eye",
                        terminal_result_builder=forged,
                    )
                self.assertNotIn(history.MENU_CONTROL_HISTORY_MARKER_KEY, self.scene)

    def test_legacy_root_checkpoint_terminal_fails_closed(self) -> None:
        self._arm()
        marker = json.loads(self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY])
        nested = marker["terminalResult"]["terminalEvidence"].pop(
            "nativeUndoCheckpoint"
        )
        marker["terminalResult"]["terminalEvidence"].update(nested)
        marker["terminalResultContentSha256"] = history._canonical_sha256(
            marker["terminalResult"]
        )
        marker["checkpointContentSha256"] = history._canonical_sha256(
            history.MenuControlHistoryController._checkpoint_identity_from_marker(marker)
        )
        marker["markerContentSha256"] = history._canonical_sha256(
            history.MenuControlHistoryController._marker_identity(marker)
        )
        self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY] = json.dumps(marker)

        with self.assertRaisesRegex(RuntimeError, "terminal outbox identity"):
            history.MenuControlHistoryController._read_marker(self.scene)

    def test_rebind_requires_independent_complete_authority(self) -> None:
        self._arm()
        marker = json.loads(self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY])
        restarted = history.MenuControlHistoryController(self.gate)
        restarted.register()
        with self.assertRaises(TypeError):
            restarted.rebind_orphan(
                self.scene,
                instance_id=INSTANCE_ID,
                lease_id=LEASE_ID,
                expected_marker_content_sha256=marker["markerContentSha256"],
            )
        authority = _authority(marker, self.scene, self.gate)
        authority["checkpointId"] = str(uuid.uuid4())
        body = dict(authority)
        body.pop("authorityMacSha256")
        authority["authorityMacSha256"] = history._canonical_sha256(body)
        with self.assertRaisesRegex(ValueError, "authority MAC"):
            restarted.rebind_orphan(self.scene, authority)

    def test_rebind_rejects_expired_replayed_and_copied_scene_authority(self) -> None:
        self._arm()
        marker = json.loads(self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY])
        expired = _authority(marker, self.scene, self.gate, ttl_seconds=1)
        self.now += timedelta(seconds=2)
        restarted = history.MenuControlHistoryController(self.gate)
        restarted.register()
        with self.assertRaisesRegex(ValueError, "expired"):
            restarted.rebind_orphan(self.scene, expired)

        self.now -= timedelta(seconds=2)
        valid = _authority(marker, self.scene, self.gate)
        restarted.rebind_orphan(self.scene, valid)
        restarted.loaded_file()
        with self.assertRaisesRegex(ValueError, "already consumed"):
            restarted.rebind_orphan(self.scene, valid)

        copied = _Scene(99)
        copied.update(self.scene)
        fake_bpy.data.scenes = [copied]
        fake_bpy.context.scene = copied
        copied_controller = history.MenuControlHistoryController(self.gate)
        copied_controller.register()
        original_scene_authority = _authority(marker, self.scene, self.gate)
        with self.assertRaisesRegex(ValueError, "authority binding"):
            copied_controller.rebind_orphan(copied, original_scene_authority)

    def test_transition_outbox_limit_is_checked_before_transactional_write(self) -> None:
        self._arm()
        for index in range(32):
            target = 7 if index % 2 == 0 else 8
            self.live = _fingerprint(target)
            self.controller.sync("undo" if target == 7 else "redo")
        previous = self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY]
        self.live = _fingerprint(7)
        self.controller.sync("undo")
        self.assertEqual(self.controller.status, "recovery_required")
        self.assertEqual(self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY], previous)
        self.assertIsNotNone(history.MenuControlHistoryController._read_marker(self.scene))

    def test_post_write_validation_failure_restores_previous_marker(self) -> None:
        self._arm()
        previous = self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY]
        corrupting = _CorruptingScene(self.scene.session_uid)
        corrupting.update(self.scene)
        entry = self.controller._current
        corrupting.corrupt_next_write = True
        with self.assertRaisesRegex(RuntimeError, "marker is invalid"):
            self.controller._write_marker(corrupting, entry)
        self.assertEqual(corrupting[history.MENU_CONTROL_HISTORY_MARKER_KEY], previous)

    def test_failure_marker_restart_rebind_rejects_unrecorded_restore(self) -> None:
        self.controller.register()
        self.live = "e" * 64
        evidence = {
            "ok": False, "executorId": proof.EXECUTOR_ID, "mutationStarted": True,
            "requiresUndoRecovery": True, "failureStatus": "failed_checkpointed",
            "currentSceneFingerprintSha256": self.live,
            "currentSceneSnapshot": {"failure": "current"},
        }
        evidence["currentSceneFingerprintSha256"] = proof.compute_scene_fingerprint_sha256(
            evidence["currentSceneSnapshot"]
        )
        self.live = evidence["currentSceneFingerprintSha256"]
        baseline_evidence = {
            "baselineSceneSnapshot": deepcopy(_BASELINE_SCENE),
            "baselineSceneFingerprintSha256": _fingerprint(0),
        }
        evidence.update(baseline_evidence)
        self.controller.arm_failed(
            self.scene, evidence, proof_id=PROOF_ID, replay_id=REPLAY_ID,
            target_id="proof.uv_sphere.eye",
            terminal_result_builder=_terminal("failed_checkpointed"),
        )
        marker = json.loads(self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY])
        restarted = history.MenuControlHistoryController(self.gate)
        restarted.register()
        self.live = _fingerprint(0)
        with self.assertRaisesRegex(ValueError, "lacks a durable transition"):
            restarted.rebind_orphan(
                self.scene, _authority(marker, self.scene, self.gate)
            )
        self.assertTrue(restarted.mutation_locked)
        self.assertEqual(restarted.status, "recovery_required")
        self.assertIsNone(restarted.current_checkpoint())

    def test_acknowledged_restored_history_can_be_superseded_before_new_work(
        self,
    ) -> None:
        self._arm()
        terminal_hash = self.controller.current_checkpoint()[
            "terminalResultContentSha256"
        ]
        self.assertTrue(self.controller.acknowledge_terminal_result(terminal_hash))
        for cursor in range(7, -1, -1):
            self.live = _fingerprint(cursor)
            self.controller.sync("undo")
        transition_hashes = self.controller.current_checkpoint()[
            "transitionResultContentSha256s"
        ]
        self.controller.acknowledge_transition_results(transition_hashes)

        invalidation_observations = []

        def invalidate_redo() -> bool:
            invalidation_observations.append(
                history.MENU_CONTROL_HISTORY_MARKER_KEY not in self.scene
            )
            return True

        self.assertTrue(
            self.controller.supersede_restored(
                self.scene,
                invalidate_redo=invalidate_redo,
            )
        )

        self.assertEqual(invalidation_observations, [True])
        self.assertNotIn(history.MENU_CONTROL_HISTORY_MARKER_KEY, self.scene)
        self.assertIsNone(self.controller.current_checkpoint())
        self.assertFalse(self.controller.mutation_locked)
        self.assertEqual(self.controller.status, "superseded")
        self.assertFalse(
            self.controller.supersede_restored(
                self.scene,
                invalidate_redo=lambda: self.fail(
                    "an absent restored history must not invalidate Redo again"
                ),
            )
        )

    def test_redo_invalidation_failure_restores_exact_baseline_marker(self) -> None:
        self._arm()
        terminal_hash = self.controller.current_checkpoint()[
            "terminalResultContentSha256"
        ]
        self.assertTrue(self.controller.acknowledge_terminal_result(terminal_hash))
        for cursor in range(7, -1, -1):
            self.live = _fingerprint(cursor)
            self.controller.sync("undo")
        transition_hashes = self.controller.current_checkpoint()[
            "transitionResultContentSha256s"
        ]
        self.controller.acknowledge_transition_results(transition_hashes)
        marker = self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY]

        def reject_invalidation() -> bool:
            self.assertNotIn(history.MENU_CONTROL_HISTORY_MARKER_KEY, self.scene)
            return False

        with self.assertRaisesRegex(RuntimeError, "Redo invalidation failed"):
            self.controller.supersede_restored(
                self.scene,
                invalidate_redo=reject_invalidation,
            )

        self.assertEqual(
            self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY], marker
        )
        self.assertEqual(self.controller.cursor, 0)
        self.assertEqual(self.controller.status, "restored")
        self.assertFalse(self.controller.mutation_locked)

    def test_redo_invalidator_exception_restores_exact_baseline_marker(self) -> None:
        self._arm()
        terminal_hash = self.controller.current_checkpoint()[
            "terminalResultContentSha256"
        ]
        self.assertTrue(self.controller.acknowledge_terminal_result(terminal_hash))
        for cursor in range(7, -1, -1):
            self.live = _fingerprint(cursor)
            self.controller.sync("undo")
        transition_hashes = self.controller.current_checkpoint()[
            "transitionResultContentSha256s"
        ]
        self.controller.acknowledge_transition_results(transition_hashes)
        marker = self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY]

        def fail_invalidation() -> bool:
            raise RuntimeError("undo push unavailable")

        with self.assertRaisesRegex(RuntimeError, "Redo invalidation failed"):
            self.controller.supersede_restored(
                self.scene,
                invalidate_redo=fail_invalidation,
            )

        self.assertEqual(
            self.scene[history.MENU_CONTROL_HISTORY_MARKER_KEY], marker
        )
        self.assertEqual(self.controller.cursor, 0)
        self.assertEqual(self.controller.status, "restored")

    def test_unacknowledged_restored_history_cannot_be_superseded(self) -> None:
        self._arm()
        for cursor in range(7, -1, -1):
            self.live = _fingerprint(cursor)
            self.controller.sync("undo")
        transition_hashes = self.controller.current_checkpoint()[
            "transitionResultContentSha256s"
        ]
        self.controller.acknowledge_transition_results(transition_hashes)

        with self.assertRaisesRegex(RuntimeError, "acknowledged restored baseline"):
            self.controller.supersede_restored(
                self.scene,
                invalidate_redo=lambda: True,
            )
        self.assertIn(history.MENU_CONTROL_HISTORY_MARKER_KEY, self.scene)


if __name__ == "__main__":
    unittest.main()
