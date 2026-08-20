"""Pure-Python tests for the fail-closed shortcut native-history journal."""

from __future__ import annotations

from copy import deepcopy
from importlib import import_module
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from typing import Mapping
import unittest
import uuid


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_shortcut_history_test"


def _persistent(callback):
    return callback


class _Scene(dict):
    def __init__(self, session_uid: int = 17) -> None:
        super().__init__()
        self.session_uid = session_uid


fake_handlers = SimpleNamespace(undo_post=[], redo_post=[], load_post=[])
fake_bpy = ModuleType("bpy")
fake_bpy.__path__ = []
fake_bpy.app = SimpleNamespace(
    handlers=fake_handlers,
    timers=SimpleNamespace(register=lambda *_args, **_kwargs: None),
    version_string="test",
)
fake_bpy.context = SimpleNamespace()
fake_bpy.data = SimpleNamespace(scenes=[])
fake_bpy_app = ModuleType("bpy.app")
fake_bpy_app.handlers = fake_handlers
fake_bpy_handlers = ModuleType("bpy.app.handlers")
fake_bpy_handlers.persistent = _persistent
sys.modules["bpy"] = fake_bpy
sys.modules["bpy.app"] = fake_bpy_app
sys.modules["bpy.app.handlers"] = fake_bpy_handlers

operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
proof = import_module(f"{PACKAGE_NAME}.infrastructure.shortcut_proof")
history = import_module(f"{PACKAGE_NAME}.infrastructure.shortcut_history")


CONTEXT = {
    "windowId": "123",
    "areaType": "VIEW_3D",
    "regionType": "WINDOW",
    "mode": "OBJECT",
}
STACK_HASH = "a" * 64
RECEIPT_IDENTITY = {
    "proof_id": "00000000-0000-4000-8000-000000000011",
    "request_id": "00000000-0000-4000-8000-000000000012",
    "delivery_id": "00000000-0000-4000-8000-000000000013",
    "binding_content_sha256": "b" * 64,
}
RECOVERY_INSTANCE_ID = "00000000-0000-4000-8000-000000000014"
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


def _event(
    event_type: str,
    value: str,
    *,
    ctrl: bool = False,
    unicode: str | None = None,
    role: str = "viewport_center",
) -> dict[str, object]:
    result: dict[str, object] = {
        "type": event_type,
        "value": value,
        "ctrl": ctrl,
        "shift": False,
        "point": {"x": 400, "y": 300, "role": role},
    }
    if unicode is not None:
        result["unicode"] = unicode
    return result


class ShortcutHistoryCanonicalHashTests(unittest.TestCase):
    def test_canonical_hash_matches_protocol_shared_vector(self) -> None:
        self.assertEqual(
            history._canonical_sha256(CANONICAL_HASH_VECTOR),
            CANONICAL_HASH_VECTOR_SHA256,
        )


def _snapshots(level: int = 2) -> tuple[dict[str, object], dict[str, object]]:
    shared = {
        "formatVersion": "1.0.0",
        "target": {"objectName": "Cube", "objectType": "MESH", "meshName": "Cube"},
        "context": {
            "mode": "OBJECT",
            "activeObjectName": "Cube",
            "selectedObjectNames": ["Cube"],
        },
    }
    baseline = {
        **shared,
        "mesh": {
            "baseTopology": {"vertices": 8, "edges": 12, "polygons": 6},
            "evaluatedTopology": {"vertices": 8, "edges": 12, "polygons": 6},
        },
        "modifiers": [],
    }
    final = {
        **shared,
        "mesh": {
            "baseTopology": {"vertices": 8, "edges": 12, "polygons": 6},
            "evaluatedTopology": proof.EXPECTED_TOPOLOGY[level],
        },
        "modifiers": [
            {
                "name": "Subdivision",
                "type": "SUBSURF",
                "levels": level,
                "renderLevels": 2,
                "flags": proof.EXPECTED_MODIFIER_FLAGS,
            }
        ],
    }
    return baseline, final


def _receipts(level: int = 2) -> list[dict[str, object]]:
    events = (
        (_event("ONE", "PRESS", ctrl=True), _event("ONE", "RELEASE", ctrl=True)),
        (_event("F9", "PRESS"), _event("F9", "RELEASE")),
        (
            _event("MOUSEMOVE", "NOTHING", role="level_control"),
            _event("LEFTMOUSE", "PRESS", role="level_control"),
            _event("LEFTMOUSE", "RELEASE", role="level_control"),
            _event("LEFTMOUSE", "PRESS", role="level_control"),
            _event("LEFTMOUSE", "RELEASE", role="level_control"),
            _event("A", "PRESS", ctrl=True),
            _event({1: "ONE", 2: "TWO", 3: "THREE"}[level], "PRESS", unicode=str(level)),
            _event("RET", "PRESS"),
            _event("RET", "RELEASE"),
        ),
        (_event("RET", "PRESS"), _event("RET", "RELEASE")),
    )
    result = []
    previous = None
    for index, operation_id in enumerate(proof.OPERATION_IDS):
        receipt = proof.build_operation_receipt(
            **RECEIPT_IDENTITY,
            operation_index=index,
            operation_id=operation_id,
            event_evidence=events[index],
            observation={"viewportLevel": level} if index == 2 else {},
            previous_receipt_sha256=previous,
            context=CONTEXT,
            operator_stack_before_sha256=STACK_HASH,
            operator_stack_after_sha256=STACK_HASH,
        )
        result.append(receipt)
        previous = receipt["contentSha256"]
    return result


def _success_evidence(level: int = 2) -> dict[str, object]:
    baseline, final = _snapshots(level)
    baseline_hash = proof.compute_shortcut_scene_fingerprint_sha256(baseline)
    final_hash = proof.compute_shortcut_scene_fingerprint_sha256(final)
    undo_observation = {
        "satisfied": True,
        "sceneFingerprintSha256": baseline_hash,
    }
    undo_observation["contentSha256"] = history._canonical_sha256(undo_observation)
    redo_observation = {
        "satisfied": True,
        "sceneFingerprintSha256": final_hash,
    }
    redo_observation["contentSha256"] = history._canonical_sha256(redo_observation)
    return {
        "formatVersion": "1.0.0",
        "executorId": proof.EXECUTOR_ID,
        **proof.execution_evidence_claims(),
        "ok": True,
        "targetLevel": level,
        "mutationStarted": True,
        "lastCompletedOperation": proof.OPERATION_IDS[-1],
        "requiresUndoToUnlock": True,
        "preflight": {
            "satisfied": True,
            "objectName": "Cube",
            "modifierCount": 0,
            "mode": "OBJECT",
        },
        "baselineSceneSnapshot": baseline,
        "baselineSceneFingerprintSha256": baseline_hash,
        "finalSceneSnapshot": final,
        "finalSceneFingerprintSha256": final_hash,
        "operationReceipts": _receipts(level),
        "operationReceiptChainVerified": True,
        "observation": {
            "kind": "subdivision_surface_shortcut_ready",
            "satisfied": True,
            "viewportLevel": level,
            "modifierCount": 1,
            "subsurfModifierCount": 1,
            "observedAt": "2026-08-20T00:00:00Z",
        },
        "nativeHistory": {
            "availability": "verified",
            "boundary": "single_native_undo_redo",
            "undoObservation": undo_observation,
            "redoObservation": redo_observation,
        },
    }


def _failed_checkpoint_evidence(receipt_count: int = 1) -> dict[str, object]:
    baseline, current = _snapshots()
    receipts = _receipts()[:receipt_count]
    return {
        "formatVersion": "1.0.0",
        "executorId": proof.EXECUTOR_ID,
        **proof.execution_evidence_claims(),
        "ok": False,
        "targetProfile": proof.TARGET_PROFILE,
        "failureStatus": "failed_checkpointed",
        "failedStep": "test failure",
        "error": "RuntimeError: injected failure",
        "mutationStarted": True,
        "lastCompletedOperation": (
            None if not receipts else receipts[-1]["operationId"]
        ),
        "requiresUndoRecovery": True,
        "operationReceipts": receipts,
        "operationReceiptPrefixVerified": True,
        "operationReceiptChainComplete": receipt_count == len(proof.OPERATION_IDS),
        "operationReceiptChainVerified": receipt_count == len(proof.OPERATION_IDS),
        "baselineSceneSnapshot": baseline,
        "baselineSceneFingerprintSha256": (
            proof.compute_shortcut_scene_fingerprint_sha256(baseline)
        ),
        "currentSceneSnapshot": current,
        "currentSceneFingerprintSha256": (
            proof.compute_shortcut_scene_fingerprint_sha256(current)
        ),
        "nativeHistory": {
            "status": "failed_checkpointed",
            "availability": "failed_checkpointed",
        },
    }


def _success_terminal_result(checkpoint: dict[str, object]) -> dict[str, object]:
    receipts = _receipts()
    return {
        "formatVersion": "1.0.0",
        "target": {"adapterId": "blender", "instanceId": RECOVERY_INSTANCE_ID},
        "requestId": RECEIPT_IDENTITY["request_id"],
        "replayId": checkpoint["replayId"],
        "proofId": checkpoint["proofId"],
        "deliveryId": RECEIPT_IDENTITY["delivery_id"],
        "bindingContentSha256": RECEIPT_IDENTITY["binding_content_sha256"],
        "status": "succeeded",
        "terminalEvidence": {
            "kind": "succeeded_locked",
            "attestation": {
                "operationReceipts": receipts,
                "strongObservation": {
                    "contentSha256": checkpoint["strongObservationContentSha256"],
                    "viewportLevel": checkpoint["finalState"]["viewportLevel"],
                    "modifierCount": 1,
                },
                "nativeUndoCheckpoint": checkpoint,
            },
        },
    }


def _transition_terminal_result(transition, terminal_result) -> dict[str, object]:
    checkpoint = terminal_result["terminalEvidence"]["attestation"][
        "nativeUndoCheckpoint"
    ]
    return {
        **{
            field: deepcopy(terminal_result[field])
            for field in (
                "formatVersion", "target", "requestId", "replayId", "proofId",
                "deliveryId", "bindingContentSha256",
            )
        },
        "status": transition.status,
        "terminalEvidence": {
            "kind": transition.status,
            "sourceCheckpointId": transition.checkpoint_id,
            "undoLockId": transition.undo_lock_id,
            "baselineSceneFingerprintSha256": checkpoint[
                "baselineSceneFingerprintSha256"
            ],
            "lockedSceneFingerprintSha256": checkpoint[
                "finalSceneFingerprintSha256"
            ],
            "currentSceneFingerprintSha256": transition.scene_fingerprint_sha256,
        },
    }


def _failure_terminal_result(
    checkpoint: dict[str, object], receipt_count: int
) -> dict[str, object]:
    return {
        "formatVersion": "1.0.0",
        "requestId": RECEIPT_IDENTITY["request_id"],
        "replayId": checkpoint["replayId"],
        "proofId": checkpoint["proofId"],
        "deliveryId": RECEIPT_IDENTITY["delivery_id"],
        "bindingContentSha256": RECEIPT_IDENTITY["binding_content_sha256"],
        "status": "failed_checkpointed",
        "terminalEvidence": {
            "kind": "failed_checkpointed",
            "checkpoint": checkpoint,
            "receiptPrefix": _receipts()[:receipt_count],
        },
    }


def _rebind_delivery(
    checkpoint: Mapping[str, object], marker: Mapping[str, object]
) -> dict[str, object]:
    return {
        "formatVersion": "1.0.0",
        "kind": "native_history_rebind",
        "requestId": RECEIPT_IDENTITY["request_id"],
        "replayId": checkpoint["replayId"],
        "proofId": checkpoint["proofId"],
        "deliveryId": RECEIPT_IDENTITY["delivery_id"],
        "target": {"adapterId": "blender", "instanceId": RECOVERY_INSTANCE_ID},
        "bindingContentSha256": RECEIPT_IDENTITY["binding_content_sha256"],
        "binding": {
            "proofId": checkpoint["proofId"],
            "requestId": RECEIPT_IDENTITY["request_id"],
            "replayId": checkpoint["replayId"],
            "acceptedAction": {"arguments": {"targetId": checkpoint["targetId"]}},
            "integrity": {
                "contentSha256": RECEIPT_IDENTITY["binding_content_sha256"]
            },
        },
        "recoveryId": str(uuid.uuid4()),
        "history": {
            "checkpointId": checkpoint["checkpointId"],
            "undoLockId": checkpoint["undoLockId"],
            "checkpointKind": "success",
            "baselineSceneFingerprintSha256": checkpoint[
                "baselineSceneFingerprintSha256"
            ],
            "lockedSceneFingerprintSha256": checkpoint[
                "finalSceneFingerprintSha256"
            ],
            "terminalResultContentSha256": marker[
                "terminalResultContentSha256"
            ],
        },
        "expectedMarkerContentSha256": history._canonical_sha256(
            history.ShortcutHistoryController._marker_identity(marker)
        ),
        "expectedResultContentSha256": marker["terminalResultContentSha256"],
        "expectedStatus": str(marker["terminalResult"]["status"]),
        "recoveryRequestedAt": "2026-08-20T00:00:00Z",
    }


def _terminal_challenge(marker: Mapping[str, object]) -> dict[str, object]:
    result = marker["terminalResult"]
    assert isinstance(result, Mapping)
    return {
        **{
            field: deepcopy(result.get(field))
            for field in (
                "formatVersion", "requestId", "replayId", "proofId", "deliveryId",
                "target", "targetProfile", "proposalId", "plan", "executionId",
                "leafId", "interactionCatalogVersion", "interactionCatalogContentSha256",
                "shortcutTrackContentSha256", "bindingContentSha256", "binding",
                "executorId", "executionBoundary", "authorization", "transport",
                "operationIds", "expectedState", "requestedAt", "dispatchedAt",
            )
        },
        "kind": "native_terminal_reconcile",
        "recoveryId": str(uuid.uuid4()),
        "acknowledgedProgressReceiptChainHeads": [],
        "recoveryRequestedAt": "2026-08-20T00:00:00Z",
    }


class ShortcutHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        fake_handlers.undo_post.clear()
        fake_handlers.redo_post.clear()
        fake_handlers.load_post.clear()
        self.scene = _Scene()
        fake_bpy.data.scenes = [self.scene]
        self.state = {"snapshot": _snapshots()[1]}
        self.controller = history.ShortcutHistoryController(
            lambda: self.state["snapshot"]
        )

    def _arm(self) -> dict[str, object]:
        self.controller.register()
        return self.controller.arm(
            self.scene,
            _success_evidence(),
            proof_id=str(uuid.uuid4()),
            replay_id=str(uuid.uuid4()),
            target_id="object:cube",
            strong_observation_content_sha256="b" * 64,
            terminal_result_builder=_success_terminal_result,
        )

    def test_controller_never_models_or_invokes_managed_navigation(self) -> None:
        source = Path(history.__file__).read_text(encoding="utf-8")

        self.assertNotIn("bpy.ops.operating_line.next", source)
        self.assertNotIn("bpy.ops.object.subdivision_set", source)
        self.assertNotIn("modifiers.new", source)
        self.assertNotIn("modifier.levels =", source)

    def test_registers_deduplicated_handlers_and_unregisters_when_safe(self) -> None:
        self.controller.register()
        self.controller.register()

        self.assertEqual(len(fake_handlers.undo_post), 1)
        self.assertEqual(len(fake_handlers.redo_post), 1)
        self.assertEqual(len(fake_handlers.load_post), 1)

        self.controller.unregister()
        self.assertEqual(fake_handlers.undo_post, [])
        self.assertEqual(fake_handlers.redo_post, [])
        self.assertEqual(fake_handlers.load_post, [])

    def test_arm_requires_exact_success_evidence_and_proven_current_final(self) -> None:
        self.controller.register()
        tampered = _success_evidence()
        tampered["executorId"] = "blender.raw.input"
        with self.assertRaisesRegex(ValueError, "fixed-executor"):
            self.controller.arm(
                self.scene, tampered, terminal_result_builder=_success_terminal_result
            )

        self.state["snapshot"] = _snapshots()[0]
        with self.assertRaisesRegex(ValueError, "proven final"):
            self.controller.arm(
                self.scene,
                _success_evidence(),
                terminal_result_builder=_success_terminal_result,
            )
        self.assertFalse(self.controller.mutation_locked)
        self.assertNotIn(history.SHORTCUT_HISTORY_MARKER_KEY, self.scene)

    def test_arm_holds_lock_and_returns_protocol_shaped_checkpoint(self) -> None:
        attestation = self._arm()

        self.assertTrue(self.controller.mutation_locked)
        self.assertEqual(attestation["operation"], "shortcut_proof")
        self.assertEqual(attestation["targetId"], "object:cube")
        self.assertTrue(attestation["marker"]["matched"])
        self.assertTrue(attestation["journal"]["mutationLeaseHeld"])
        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        self.assertEqual(marker["checkpointId"], attestation["checkpointId"])

    def test_exact_undo_unlocks_and_exact_redo_relocks_with_callbacks(self) -> None:
        restored = []
        reapplied = []
        self.controller.register(restored.append, reapplied.append)
        self.controller.arm(
            self.scene,
            _success_evidence(),
            terminal_result_builder=_success_terminal_result,
        )

        self.state["snapshot"] = _snapshots()[0]
        self.controller.sync("undo")
        self.assertFalse(self.controller.mutation_locked)
        self.assertEqual(restored[0].status, "restored")

        self.state["snapshot"] = _snapshots()[1]
        self.controller.sync("redo")
        self.assertTrue(self.controller.mutation_locked)
        self.assertEqual(reapplied[0].status, "reapplied_locked")
        self.assertEqual(self.controller.journal_size, 3)

    def test_transition_outbox_persists_before_publish_and_clears_exact_ack(self) -> None:
        published = []

        def build(transition):
            return _transition_terminal_result(
                transition, self.controller._current.terminal_result
            )

        def publish(result):
            marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
            self.assertEqual(marker["transitionResults"][-1], result)
            published.append(result)

        self.controller.register(
            restored_result_builder=build,
            reapplied_result_builder=build,
            transition_result_callback=publish,
        )
        self.controller.arm(
            self.scene,
            _success_evidence(),
            terminal_result_builder=_success_terminal_result,
        )
        self.state["snapshot"] = _snapshots()[0]
        self.controller.sync("undo")

        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        self.assertEqual(len(marker["transitionResults"]), 1)
        result_hash = marker["transitionResultContentSha256s"][0]
        self.assertEqual(len(published), 1)

        self.controller.acknowledge_transition_results(["0" * 64])
        self.assertEqual(
            len(json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])[
                "transitionResults"
            ]),
            1,
        )
        self.controller.acknowledge_transition_results([result_hash])
        cleared = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        self.assertEqual(cleared["transitionResults"], [])
        self.assertEqual(cleared["acknowledgedResultContentSha256"], result_hash)

        tampered = deepcopy(cleared)
        tampered["acknowledgedResult"]["terminalEvidence"][
            "sourceCheckpointId"
        ] = str(uuid.uuid4())
        tampered["acknowledgedResultContentSha256"] = history._canonical_sha256(
            tampered["acknowledgedResult"]
        )
        self.scene[history.SHORTCUT_HISTORY_MARKER_KEY] = json.dumps(tampered)
        quarantined = history.ShortcutHistoryController(lambda: _snapshots()[0])
        quarantined.register()
        self.assertTrue(quarantined.mutation_locked)
        with self.assertRaisesRegex(RuntimeError, "failed closed"):
            quarantined.current_attestation()

    def test_transition_reconcile_sends_only_suffix_after_server_head(self) -> None:
        def build(transition):
            return _transition_terminal_result(
                transition, self.controller._current.terminal_result
            )

        self.controller.register(
            restored_result_builder=build,
            reapplied_result_builder=build,
        )
        checkpoint = self.controller.arm(
            self.scene,
            _success_evidence(),
            terminal_result_builder=_success_terminal_result,
        )
        self.state["snapshot"] = _snapshots()[0]
        self.controller.sync("undo")
        self.state["snapshot"] = _snapshots()[1]
        self.controller.sync("redo")
        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        first_hash, second_hash = marker["transitionResultContentSha256s"]
        challenge = _rebind_delivery(checkpoint, marker)
        challenge["expectedResultContentSha256"] = first_hash
        challenge["expectedStatus"] = "restored"

        ack = self.controller.reconcile_transition_outbox(self.scene, challenge)

        self.assertEqual(ack["kind"], "native_history_transition_reconcile")
        self.assertEqual([result["status"] for result in ack["results"]], ["reapplied_locked"])
        self.assertEqual(
            json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])[
                "transitionResultContentSha256s"
            ],
            [first_hash, second_hash],
        )
        self.controller.acknowledge_transition_recovery(challenge["recoveryId"])
        cleared = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        self.assertEqual(cleared["transitionResults"], [])
        self.assertEqual(cleared["acknowledgedResultContentSha256"], second_hash)

    def test_publish_failure_keeps_persisted_result_and_fails_closed(self) -> None:
        self.controller.register(
            restored_result_builder=lambda transition: _transition_terminal_result(
                transition, self.controller._current.terminal_result
            ),
            transition_result_callback=lambda _result: (_ for _ in ()).throw(
                RuntimeError("injected post queue failure")
            ),
        )
        self.controller.arm(
            self.scene,
            _success_evidence(),
            terminal_result_builder=_success_terminal_result,
        )
        self.state["snapshot"] = _snapshots()[0]

        self.controller.sync("undo")

        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        self.assertEqual(marker["transitionResults"][0]["status"], "restored")
        self.assertTrue(self.controller.mutation_locked)
        self.assertIn("post queue failure", self.controller.error)

    def test_unacked_restored_outbox_survives_unregister_and_rebuild(self) -> None:
        self.controller.register(
            restored_result_builder=lambda transition: _transition_terminal_result(
                transition, self.controller._current.terminal_result
            )
        )
        self.controller.arm(
            self.scene,
            _success_evidence(),
            terminal_result_builder=_success_terminal_result,
        )
        self.state["snapshot"] = _snapshots()[0]
        self.controller.sync("undo")

        self.controller.unregister()
        replacement = history.ShortcutHistoryController(lambda: _snapshots()[0])
        replacement.register()

        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        self.assertEqual(marker["transitionResults"][0]["status"], "restored")
        self.assertTrue(replacement.has_transition_outbox())

    def test_transition_outbox_is_bounded_to_32_and_fails_closed(self) -> None:
        self.controller.register(
            restored_result_builder=lambda transition: _transition_terminal_result(
                transition, self.controller._current.terminal_result
            ),
            reapplied_result_builder=lambda transition: _transition_terminal_result(
                transition, self.controller._current.terminal_result
            ),
        )
        self.controller.arm(
            self.scene,
            _success_evidence(),
            terminal_result_builder=_success_terminal_result,
        )
        for index in range(32):
            direction = "undo" if index % 2 == 0 else "redo"
            self.state["snapshot"] = _snapshots()[0 if direction == "undo" else 1]
            self.controller.sync(direction)

        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        self.assertEqual(len(marker["transitionResults"]), 32)
        self.state["snapshot"] = _snapshots()[0]
        self.controller.sync("undo")
        self.assertTrue(self.controller.mutation_locked)
        self.assertIn("outbox limit", self.controller.error)
        self.assertEqual(
            len(json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])[
                "transitionResults"
            ]),
            32,
        )

    def test_partial_or_unrelated_history_event_fails_closed(self) -> None:
        self._arm()
        _baseline, partial = _snapshots()
        partial = json.loads(json.dumps(partial))
        partial["modifiers"][0]["levels"] = 3
        self.state["snapshot"] = partial

        self.controller.sync("undo")

        self.assertTrue(self.controller.mutation_locked)
        self.assertIn("failed closed", self.controller.error)
        with self.assertRaisesRegex(RuntimeError, "failed closed"):
            self.controller.current_attestation()

    def test_marker_is_association_not_restore_evidence(self) -> None:
        self._arm()
        del self.scene[history.SHORTCUT_HISTORY_MARKER_KEY]
        self.state["snapshot"] = _snapshots()[0]

        self.controller.sync("undo")

        self.assertFalse(self.controller.mutation_locked)
        self.assertIsNone(self.controller.current_attestation())

    def test_file_load_and_restart_discovery_never_silently_unlock(self) -> None:
        self._arm()
        self.controller.loaded_file()
        self.assertTrue(self.controller.mutation_locked)
        with self.assertRaisesRegex(RuntimeError, "failed closed"):
            self.controller.current_attestation()

        replacement = history.ShortcutHistoryController(lambda: _snapshots()[1])
        replacement.register()
        self.assertTrue(replacement.mutation_locked)
        self.assertIn("persisted", replacement.error.lower())

    def test_unregister_keeps_marker_while_mutation_is_locked(self) -> None:
        self._arm()

        self.controller.unregister()

        self.assertIn(history.SHORTCUT_HISTORY_MARKER_KEY, self.scene)
        self.assertTrue(self.controller.mutation_locked)

    def test_failed_checkpoint_accepts_zero_to_four_receipt_prefixes(self) -> None:
        for receipt_count in range(5):
            with self.subTest(receipt_count=receipt_count):
                scene = _Scene(session_uid=100 + receipt_count)
                fake_bpy.data.scenes = [scene]
                state = {"snapshot": _snapshots()[1]}
                controller = history.ShortcutHistoryController(
                    lambda: state["snapshot"]
                )
                controller.register()
                evidence = _failed_checkpoint_evidence(receipt_count)
                checkpoint = controller.arm_failed(
                    scene,
                    evidence,
                    proof_id=str(uuid.uuid4()),
                    replay_id=str(uuid.uuid4()),
                    target_id="object:cube",
                    terminal_result_builder=lambda value, count=receipt_count: _failure_terminal_result(value, count),
                )

                self.assertTrue(controller.mutation_locked)
                self.assertEqual(checkpoint["operation"], "shortcut_proof_failure")
                self.assertEqual(
                    checkpoint["lastCompletedOperationId"],
                    None if receipt_count == 0 else proof.OPERATION_IDS[receipt_count - 1],
                )
                self.assertEqual(
                    checkpoint["receiptPrefixRootSha256"],
                    None
                    if receipt_count == 0
                    else evidence["operationReceipts"][0]["contentSha256"],
                )
                controller._locked = False
                controller.unregister()

    def test_failed_checkpoint_rejects_unproven_prefix(self) -> None:
        self.controller.register()
        tampered = _failed_checkpoint_evidence(1)
        tampered["operationReceiptPrefixVerified"] = False
        with self.assertRaisesRegex(ValueError, "exact mutated failure"):
            self.controller.arm_failed(
                self.scene,
                tampered,
                proof_id=str(uuid.uuid4()),
                replay_id=str(uuid.uuid4()),
                target_id="object:cube",
                terminal_result_builder=lambda value: _failure_terminal_result(value, 1),
            )

    def test_failed_checkpoint_undo_unlocks_and_redo_relocks_without_success(self) -> None:
        restored = []
        reapplied = []
        self.controller.register(restored.append, reapplied.append)
        checkpoint = self.controller.arm_failed(
            self.scene,
            _failed_checkpoint_evidence(2),
            proof_id=str(uuid.uuid4()),
            replay_id=str(uuid.uuid4()),
            target_id="object:cube",
            terminal_result_builder=lambda value: _failure_terminal_result(value, 2),
        )

        self.state["snapshot"] = _snapshots()[0]
        self.controller.sync("undo")
        self.assertFalse(self.controller.mutation_locked)
        self.assertEqual(restored[0].status, "restored")

        self.state["snapshot"] = _snapshots()[1]
        self.controller.sync("redo")
        self.assertTrue(self.controller.mutation_locked)
        self.assertEqual(reapplied[0].status, "reapplied_locked")
        self.assertIn("not success proof", self.controller.error)
        self.assertEqual(
            json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])["checkpointId"],
            checkpoint["checkpointId"],
        )
        self.assertEqual(
            self.controller.current_attestation()["checkpointId"],
            checkpoint["checkpointId"],
        )

    def test_failed_checkpoint_never_unlocks_on_unrelated_undo(self) -> None:
        self.controller.register()
        self.controller.arm_failed(
            self.scene,
            _failed_checkpoint_evidence(0),
            proof_id=str(uuid.uuid4()),
            replay_id=str(uuid.uuid4()),
            target_id="object:cube",
            terminal_result_builder=lambda value: _failure_terminal_result(value, 0),
        )
        _baseline, unrelated = _snapshots()
        unrelated = json.loads(json.dumps(unrelated))
        unrelated["modifiers"][0]["levels"] = 3
        self.state["snapshot"] = unrelated

        self.controller.sync("undo")

        self.assertTrue(self.controller.mutation_locked)
        self.assertIn("failed closed", self.controller.error)

    def test_failure_checkpoint_arming_failure_locks_indeterminate(self) -> None:
        self.controller.register()
        self.controller._write_marker = lambda *_args: (_ for _ in ()).throw(
            RuntimeError("injected checkpoint write failure")
        )

        with self.assertRaisesRegex(RuntimeError, "injected checkpoint write failure"):
            self.controller.arm_failed(
                self.scene,
                _failed_checkpoint_evidence(4),
                proof_id=str(uuid.uuid4()),
                replay_id=str(uuid.uuid4()),
                target_id="object:cube",
                terminal_result_builder=lambda value: _failure_terminal_result(value, 4),
            )

        self.assertTrue(self.controller.mutation_locked)
        self.assertIn("injected checkpoint write failure", self.controller.error)
        with self.assertRaisesRegex(RuntimeError, "failed closed"):
            self.controller.current_attestation()

    def test_orphan_marker_rebind_requires_exact_identity_and_locked_fingerprint(self) -> None:
        checkpoint = self._arm()
        replacement = history.ShortcutHistoryController(lambda: _snapshots()[1])
        replacement.register()
        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        delivery = {
            "formatVersion": "1.0.0",
            "kind": "native_history_rebind",
            "requestId": RECEIPT_IDENTITY["request_id"],
            "replayId": checkpoint["replayId"],
            "proofId": checkpoint["proofId"],
            "deliveryId": RECEIPT_IDENTITY["delivery_id"],
            "target": {"adapterId": "blender", "instanceId": RECOVERY_INSTANCE_ID},
            "bindingContentSha256": RECEIPT_IDENTITY["binding_content_sha256"],
            "binding": {
                "proofId": checkpoint["proofId"],
                "requestId": RECEIPT_IDENTITY["request_id"],
                "replayId": checkpoint["replayId"],
                "acceptedAction": {"arguments": {"targetId": checkpoint["targetId"]}},
                "integrity": {
                    "contentSha256": RECEIPT_IDENTITY["binding_content_sha256"]
                },
            },
            "recoveryId": str(uuid.uuid4()),
            "history": {
                "checkpointId": checkpoint["checkpointId"],
                "undoLockId": checkpoint["undoLockId"],
                "checkpointKind": "success",
                "baselineSceneFingerprintSha256": checkpoint[
                    "baselineSceneFingerprintSha256"
                ],
                "lockedSceneFingerprintSha256": checkpoint[
                    "finalSceneFingerprintSha256"
                ],
                "terminalResultContentSha256": marker[
                    "terminalResultContentSha256"
                ],
            },
            "expectedMarkerContentSha256": history._canonical_sha256(
                history.ShortcutHistoryController._marker_identity(marker)
            ),
            "expectedResultContentSha256": marker["terminalResultContentSha256"],
            "expectedStatus": "succeeded",
            "recoveryRequestedAt": "2026-08-20T00:00:00Z",
        }

        rebound = replacement.rebind_orphan(self.scene, delivery)

        self.assertTrue(replacement.mutation_locked)
        self.assertEqual(rebound["history"], delivery["history"])
        self.assertTrue(rebound["mutationLocked"])
        self.assertEqual(
            rebound["currentSceneFingerprintSha256"],
            checkpoint["finalSceneFingerprintSha256"],
        )

        replacement.loaded_file()
        tampered_hash = deepcopy(delivery)
        tampered_hash["history"]["terminalResultContentSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "checkpoint identity"):
            replacement.rebind_orphan(self.scene, tampered_hash)
        tampered = deepcopy(delivery)
        tampered["proofId"] = str(uuid.uuid4())
        with self.assertRaisesRegex(ValueError, "identity"):
            replacement.rebind_orphan(self.scene, tampered)
        self.assertTrue(replacement.mutation_locked)

    def test_live_current_recovery_challenges_only_acknowledge_existing_entry(self) -> None:
        checkpoint = self._arm()
        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        original_entry = self.controller._current
        original_journal_size = self.controller.journal_size

        terminal_ack = self.controller.reconcile_terminal_outbox(
            self.scene, _terminal_challenge(marker)
        )
        rebind_ack = self.controller.rebind_orphan(
            self.scene, _rebind_delivery(checkpoint, marker)
        )

        self.assertEqual(terminal_ack["result"], marker["terminalResult"])
        self.assertEqual(rebind_ack["history"]["checkpointId"], checkpoint["checkpointId"])
        self.assertIs(self.controller._current, original_entry)
        self.assertEqual(self.controller.journal_size, original_journal_size)
        self.assertEqual(self.controller._status, "armed_locked")

        tampered = _rebind_delivery(checkpoint, marker)
        tampered["history"]["terminalResultContentSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "checkpoint identity"):
            self.controller.rebind_orphan(self.scene, tampered)
        terminal_tampered = _terminal_challenge(marker)
        terminal_tampered["deliveryId"] = str(uuid.uuid4())
        with self.assertRaisesRegex(ValueError, "identity"):
            self.controller.reconcile_terminal_outbox(self.scene, terminal_tampered)
        self.assertIs(self.controller._current, original_entry)
        self.assertEqual(self.controller.journal_size, original_journal_size)

    def test_orphan_rebind_preserves_previous_checkpoint_lineage(self) -> None:
        first = self._arm()
        self.state["snapshot"] = _snapshots()[0]
        self.controller.sync("undo")
        self.state["snapshot"] = _snapshots()[1]
        second = self.controller.arm(
            self.scene,
            _success_evidence(),
            proof_id=str(uuid.uuid4()),
            replay_id=str(uuid.uuid4()),
            target_id="object:cube",
            strong_observation_content_sha256="b" * 64,
            terminal_result_builder=_success_terminal_result,
        )
        self.assertEqual(second["previousCheckpointId"], first["checkpointId"])
        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        replacement = history.ShortcutHistoryController(lambda: _snapshots()[1])
        replacement.register()

        replacement.rebind_orphan(self.scene, _rebind_delivery(second, marker))

        self.assertEqual(
            replacement.current_attestation()["previousCheckpointId"],
            first["checkpointId"],
        )

    def test_orphan_marker_rebind_rejects_live_fingerprint_mismatch(self) -> None:
        checkpoint = self._arm()
        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        delivery = {
            "formatVersion": "1.0.0",
            "kind": "native_history_rebind",
            "requestId": RECEIPT_IDENTITY["request_id"],
            "replayId": checkpoint["replayId"],
            "proofId": checkpoint["proofId"],
            "deliveryId": RECEIPT_IDENTITY["delivery_id"],
            "target": {"adapterId": "blender", "instanceId": RECOVERY_INSTANCE_ID},
            "bindingContentSha256": RECEIPT_IDENTITY["binding_content_sha256"],
            "binding": {
                "proofId": checkpoint["proofId"],
                "requestId": RECEIPT_IDENTITY["request_id"],
                "replayId": checkpoint["replayId"],
                "acceptedAction": {"arguments": {"targetId": checkpoint["targetId"]}},
                "integrity": {
                    "contentSha256": RECEIPT_IDENTITY["binding_content_sha256"]
                },
            },
            "recoveryId": str(uuid.uuid4()),
            "history": {
                "checkpointId": checkpoint["checkpointId"],
                "undoLockId": checkpoint["undoLockId"],
                "checkpointKind": "success",
                "baselineSceneFingerprintSha256": checkpoint[
                    "baselineSceneFingerprintSha256"
                ],
                "lockedSceneFingerprintSha256": checkpoint[
                    "finalSceneFingerprintSha256"
                ],
                "terminalResultContentSha256": marker[
                    "terminalResultContentSha256"
                ],
            },
            "expectedMarkerContentSha256": history._canonical_sha256(
                history.ShortcutHistoryController._marker_identity(marker)
            ),
            "expectedResultContentSha256": marker["terminalResultContentSha256"],
            "expectedStatus": "succeeded",
            "recoveryRequestedAt": "2026-08-20T00:00:00Z",
        }
        replacement = history.ShortcutHistoryController(lambda: _snapshots()[0])
        replacement.register()

        with self.assertRaisesRegex(ValueError, "live state"):
            replacement.rebind_orphan(self.scene, delivery)

        self.assertTrue(replacement.mutation_locked)

    def test_terminal_outbox_reconciles_exact_result_after_controller_restart(self) -> None:
        checkpoint = self._arm()
        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        result = marker["terminalResult"]
        replacement = history.ShortcutHistoryController(lambda: _snapshots()[1])
        replacement.register()
        challenge = {
            **{
                field: deepcopy(result.get(field))
                for field in (
                    "formatVersion", "requestId", "replayId", "proofId", "deliveryId",
                    "target", "targetProfile", "proposalId", "plan", "executionId",
                    "leafId", "interactionCatalogVersion", "interactionCatalogContentSha256",
                    "shortcutTrackContentSha256", "bindingContentSha256", "binding",
                    "executorId", "executionBoundary", "authorization", "transport",
                    "operationIds", "expectedState", "requestedAt", "dispatchedAt",
                )
            },
            "kind": "native_terminal_reconcile",
            "recoveryId": str(uuid.uuid4()),
            "acknowledgedProgressReceiptChainHeads": [
                receipt["contentSha256"]
                for receipt in result["terminalEvidence"]["attestation"]["operationReceipts"][:2]
            ],
            "recoveryRequestedAt": "2026-08-20T00:00:00Z",
        }

        ack = replacement.reconcile_terminal_outbox(self.scene, challenge)

        self.assertEqual(ack["result"], result)
        self.assertEqual(
            ack["expectedMarkerContentSha256"],
            history._canonical_sha256(
                history.ShortcutHistoryController._marker_identity(marker)
            ),
        )
        restored = replacement.current_attestation()
        self.assertEqual(restored["checkpointId"], checkpoint["checkpointId"])
        persisted_receipts = result["terminalEvidence"]["attestation"]["operationReceipts"]
        self.assertEqual(restored["receiptChainRootSha256"], persisted_receipts[0]["contentSha256"])
        self.assertEqual(restored["receiptChainHeadSha256"], persisted_receipts[-1]["contentSha256"])
        self.assertEqual(restored["strongObservationContentSha256"], "b" * 64)
        self.assertEqual(restored["finalState"]["viewportLevel"], 2)

    def test_terminal_outbox_tamper_and_wrong_server_progress_fail_closed(self) -> None:
        self._arm()
        marker = json.loads(self.scene[history.SHORTCUT_HISTORY_MARKER_KEY])
        result = marker["terminalResult"]
        challenge = {
            **{
                field: deepcopy(result.get(field))
                for field in (
                    "formatVersion", "requestId", "replayId", "proofId", "deliveryId",
                    "target", "targetProfile", "proposalId", "plan", "executionId",
                    "leafId", "interactionCatalogVersion", "interactionCatalogContentSha256",
                    "shortcutTrackContentSha256", "bindingContentSha256", "binding",
                    "executorId", "executionBoundary", "authorization", "transport",
                    "operationIds", "expectedState", "requestedAt", "dispatchedAt",
                )
            },
            "kind": "native_terminal_reconcile",
            "recoveryId": str(uuid.uuid4()),
            "acknowledgedProgressReceiptChainHeads": ["f" * 64],
            "recoveryRequestedAt": "2026-08-20T00:00:00Z",
        }
        replacement = history.ShortcutHistoryController(lambda: _snapshots()[1])
        replacement.register()
        with self.assertRaisesRegex(ValueError, "progress prefix"):
            replacement.reconcile_terminal_outbox(self.scene, challenge)
        self.assertTrue(replacement.mutation_locked)

        tampered_marker = deepcopy(marker)
        tampered_marker["terminalResult"]["status"] = "rejected"
        self.scene[history.SHORTCUT_HISTORY_MARKER_KEY] = json.dumps(tampered_marker)
        quarantined = history.ShortcutHistoryController(lambda: _snapshots()[1])
        quarantined.register()
        self.assertTrue(quarantined.mutation_locked)
        with self.assertRaisesRegex(RuntimeError, "failed closed"):
            quarantined.current_attestation()


if __name__ == "__main__":
    unittest.main()
