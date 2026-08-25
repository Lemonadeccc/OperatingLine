"""Atomic failure recovery for the Blender native-history journal."""

import hashlib
from importlib import import_module
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_native_history_atomic_test"


class _Scene(dict):
    session_uid = 41


class _Session:
    def __init__(self):
        self.value = "before"
        self.rejected_restore_values = set()
        self.plan_content_sha256 = "1" * 64
        self.active_step = SimpleNamespace(id="leaf.transform")
        self.completed_step_ids = ()

    def snapshot_state(self):
        return SimpleNamespace(
            value=self.value,
            receipts=(),
            leaf_operation_runs=(),
            plan_id="plan-1",
            revision=1,
            execution_id="11111111-1111-4111-8111-111111111111",
        )

    def restore_state(self, snapshot, **_kwargs):
        if snapshot.value in self.rejected_restore_values:
            raise RuntimeError(f"rejected snapshot: {snapshot.value}")
        self.value = snapshot.value


def _load_native_history(scene):
    handlers = SimpleNamespace(undo_post=[], redo_post=[], load_post=[])
    fake_bpy = ModuleType("bpy")
    fake_bpy.types = SimpleNamespace(Scene=_Scene)
    fake_bpy.data = SimpleNamespace(scenes=[scene])
    fake_bpy.app = SimpleNamespace(handlers=handlers)
    sys.modules["bpy"] = fake_bpy
    bpy_app = ModuleType("bpy.app")
    bpy_app.handlers = handlers
    sys.modules["bpy.app"] = bpy_app
    bpy_handlers = ModuleType("bpy.app.handlers")
    bpy_handlers.persistent = lambda callback: callback
    bpy_handlers.undo_post = handlers.undo_post
    bpy_handlers.redo_post = handlers.redo_post
    bpy_handlers.load_post = handlers.load_post
    sys.modules["bpy.app.handlers"] = bpy_handlers

    package = ModuleType(PACKAGE_NAME)
    package.__path__ = [str(PACKAGE_ROOT)]
    sys.modules[PACKAGE_NAME] = package
    application = ModuleType(f"{PACKAGE_NAME}.application")
    application.__path__ = [str(PACKAGE_ROOT / "application")]
    application.DemoSession = _Session
    application.SessionSnapshot = SimpleNamespace
    sys.modules[application.__name__] = application
    session_module = ModuleType(f"{PACKAGE_NAME}.application.session")
    session_module.ArtifactIdentity = SimpleNamespace
    sys.modules[session_module.__name__] = session_module
    infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
    infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
    sys.modules[infrastructure.__name__] = infrastructure
    actions = ModuleType(f"{PACKAGE_NAME}.infrastructure.snowman_actions")
    actions.__path__ = [str(PACKAGE_ROOT / "infrastructure" / "snowman_actions")]
    sys.modules[actions.__name__] = actions
    common = ModuleType(
        f"{PACKAGE_NAME}.infrastructure.snowman_actions.common"
    )
    common.ensure_receipts_intact = lambda _receipts: None
    common.rebind_receipts_after_native_restore = lambda receipts: receipts
    sys.modules[common.__name__] = common

    module_name = f"{PACKAGE_NAME}.infrastructure.native_history"
    sys.modules.pop(module_name, None)
    return import_module(module_name)


class NativeHistoryAtomicCommitTests(unittest.TestCase):
    def test_leaf_checkpoint_attestation_is_available_only_through_leaf_api(self):
        scene = _Scene()
        native_history = _load_native_history(scene)
        controller = native_history.NativeHistoryController()
        session = _Session()
        controller.register(lambda: session, lambda _transition: None, lambda: None)
        controller.prepare(session, scene, "leaf_operation")
        session.value = "operation-1"
        checkpoint_id = controller.commit(session)

        self.assertIsNone(controller.current_checkpoint_attestation(session))
        attestation = controller.current_leaf_checkpoint_attestation(session)
        self.assertEqual(attestation["checkpointId"], checkpoint_id)
        self.assertEqual(attestation["operation"], "leaf_operation")
        self.assertTrue(attestation["marker"]["matched"])
        self.assertTrue(attestation["journal"]["snapshotMatchesSession"])

        controller.prepare(session, scene, "leaf_operation")
        session.value = "operation-2"
        second_checkpoint_id = controller.commit(session)
        controller.prepare(session, scene, "next")
        session.value = "completed"
        final_checkpoint_id = controller.commit(session)
        final = controller.current_checkpoint_attestation(session)
        self.assertEqual(
            final["journal"]["lineageCheckpointIds"],
            [checkpoint_id, second_checkpoint_id, final_checkpoint_id],
        )

    def test_marker_commit_failure_rolls_back_host_and_prepared_session(self):
        scene = _Scene()
        native_history = _load_native_history(scene)
        controller = native_history.NativeHistoryController()
        session = _Session()
        controller.register(lambda: session, lambda _transition: None, lambda: None)
        controller.prepare(session, scene, "leaf_operation")
        session.value = "after"
        host = {"geometry": "after"}

        original_marker = controller._marker
        controller._marker = lambda owner: (
            None
            if native_history.NATIVE_HISTORY_MARKER_KEY in owner
            else original_marker(owner)
        )

        with self.assertRaisesRegex(RuntimeError, "operation restored"):
            controller.commit(
                session,
                rollback=lambda: host.update(geometry="before"),
                recovery_probe=lambda: host["geometry"] == "before",
            )

        self.assertEqual(host["geometry"], "before")
        self.assertEqual(session.value, "before")
        self.assertNotIn(native_history.NATIVE_HISTORY_MARKER_KEY, scene)
        self.assertEqual(controller.checkpoint_count, 1)
        self.assertEqual(controller.error, "")

        controller._marker = original_marker
        controller.prepare(session, scene, "leaf_operation")
        session.value = "retry"
        checkpoint_id = controller.commit(session)
        self.assertEqual(scene[native_history.NATIVE_HISTORY_MARKER_KEY], checkpoint_id)
        self.assertEqual(controller.checkpoint_count, 2)

    def test_marker_commit_failure_without_host_proof_requires_exact_native_undo(self):
        scene = _Scene()
        native_history = _load_native_history(scene)
        controller = native_history.NativeHistoryController()
        session = _Session()
        controller.register(lambda: session, lambda _restore: None, lambda: None)
        controller.prepare(session, scene, "next")
        session.value = "after"
        host = {"geometry": "after"}

        original_marker = controller._marker
        controller._marker = lambda owner: (
            None
            if native_history.NATIVE_HISTORY_MARKER_KEY in owner
            else original_marker(owner)
        )

        with self.assertRaisesRegex(
            native_history.NativeUndoRequiredError,
            "host recovery proof is unavailable",
        ):
            controller.commit(session)

        recovery_token = scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        self.assertEqual(session.value, "before")
        self.assertEqual(host["geometry"], "after")
        self.assertTrue(controller.requires_native_undo)
        self.assertNotEqual(controller.error, "")

        controller._marker = original_marker
        controller.sync("undo")
        self.assertTrue(controller.requires_native_undo)

        del scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        controller.sync("undo")
        self.assertFalse(controller.requires_native_undo)
        self.assertEqual(controller.error, "")
        witness = controller.peek_native_undo_restoration_witness()
        self.assertIsNotNone(witness)
        self.assertEqual(witness.direction, "undo")
        self.assertTrue(witness.recovery_probe_satisfied)
        self.assertEqual(
            witness.recovery_token_sha256,
            hashlib.sha256(recovery_token.encode("utf-8")).hexdigest(),
        )
        self.assertNotEqual(witness.recovery_token_sha256, recovery_token)
        self.assertIs(controller.consume_native_undo_restoration_witness(), witness)
        self.assertIsNone(controller.peek_native_undo_restoration_witness())

        scene[native_history.NATIVE_HISTORY_RECOVERY_KEY] = recovery_token
        controller.sync("redo")
        self.assertTrue(controller.requires_native_undo)

        del scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        controller.sync("undo")
        self.assertFalse(controller.requires_native_undo)

    def test_quarantined_host_mutation_blocks_until_exact_native_undo(self):
        scene = _Scene()
        native_history = _load_native_history(scene)
        controller = native_history.NativeHistoryController()
        session = _Session()
        restores = []
        controller.register(lambda: session, restores.append, lambda: None)
        controller.prepare(session, scene, "leaf_operation")

        failure_id = controller.commit(session, quarantine=True)
        recovery_token = scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]

        self.assertEqual(
            controller._checkpoints[failure_id].operation,
            "leaf_operation_failure",
        )
        self.assertTrue(controller.requires_native_undo)
        guard = controller.peek_native_undo_recovery_guard()
        self.assertIsNotNone(guard)
        self.assertEqual(guard.expected_restored_checkpoint_id, None)
        self.assertEqual(
            guard.recovery_token_sha256,
            hashlib.sha256(recovery_token.encode("utf-8")).hexdigest(),
        )
        with self.assertRaisesRegex(RuntimeError, "must restore"):
            controller.prepare(session, scene, "leaf_operation")

        del scene[native_history.NATIVE_HISTORY_MARKER_KEY]
        del scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        controller.sync("undo")
        self.assertEqual(controller.error, "")
        self.assertFalse(controller.requires_native_undo)
        self.assertIsNone(controller._current_id)
        self.assertEqual(restores[-1].before, restores[-1].after)
        witness = controller.peek_native_undo_restoration_witness()
        self.assertIsNotNone(witness)
        self.assertEqual(witness.recovery_token_sha256, guard.recovery_token_sha256)
        self.assertEqual(witness.restored_checkpoint_id, guard.expected_restored_checkpoint_id)
        controller.prepare(session, scene, "leaf_operation")
        controller.cancel()

        scene[native_history.NATIVE_HISTORY_MARKER_KEY] = failure_id
        scene[native_history.NATIVE_HISTORY_RECOVERY_KEY] = recovery_token
        controller.sync("redo")
        with self.assertRaisesRegex(RuntimeError, "Native Undo synchronization failed"):
            controller.prepare(session, scene, "leaf_operation")

    def test_failed_quarantine_commit_remains_locked_until_undo_event(self):
        scene = _Scene()
        native_history = _load_native_history(scene)
        controller = native_history.NativeHistoryController()
        session = _Session()
        controller.register(lambda: session, lambda _restore: None, lambda: None)
        controller.prepare(session, scene, "leaf_operation")
        host = {"geometry": "after"}
        original_marker = controller._marker
        controller._marker = lambda owner: (
            None
            if native_history.NATIVE_HISTORY_MARKER_KEY in owner
            else original_marker(owner)
        )

        with self.assertRaisesRegex(RuntimeError, "use Blender native Undo"):
            controller.commit(
                session,
                quarantine=True,
                recovery_probe=lambda: host["geometry"] == "before",
            )

        recovery_token = scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        self.assertNotEqual(controller.error, "")
        self.assertNotIn(native_history.NATIVE_HISTORY_MARKER_KEY, scene)
        with self.assertRaisesRegex(RuntimeError, "synchronization failed"):
            controller.prepare(session, scene, "leaf_operation")

        controller._marker = original_marker
        controller.sync("undo")
        self.assertTrue(controller.requires_native_undo)
        self.assertIsNone(controller.peek_native_undo_restoration_witness())
        with self.assertRaisesRegex(RuntimeError, "synchronization failed"):
            controller.prepare(session, scene, "leaf_operation")

        host["geometry"] = "before"
        controller.sync("redo")
        self.assertTrue(controller.requires_native_undo)
        del scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        controller.sync("undo")
        self.assertFalse(controller.requires_native_undo)
        self.assertEqual(controller.error, "")

        scene[native_history.NATIVE_HISTORY_RECOVERY_KEY] = recovery_token
        controller.sync("redo")
        self.assertTrue(controller.requires_native_undo)
        del scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        controller.sync("undo")
        self.assertFalse(controller.requires_native_undo)
        controller.prepare(session, scene, "leaf_operation")

    def test_probe_less_quarantine_uses_exact_undo_witness_and_redo_relocks(self):
        scene = _Scene()
        native_history = _load_native_history(scene)
        controller = native_history.NativeHistoryController()
        session = _Session()
        controller.register(lambda: session, lambda _restore: None, lambda: None)
        controller.prepare(session, scene, "leaf_operation")
        original_marker = controller._marker
        controller._marker = lambda owner: (
            None
            if native_history.NATIVE_HISTORY_MARKER_KEY in owner
            else original_marker(owner)
        )

        with self.assertRaisesRegex(RuntimeError, "use Blender native Undo"):
            controller.commit(session, quarantine=True)

        recovery_token = scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        self.assertTrue(controller.requires_native_undo)
        controller._marker = original_marker

        controller.sync("undo")
        self.assertTrue(controller.requires_native_undo)

        del scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        controller.sync("undo")
        self.assertFalse(controller.requires_native_undo)
        self.assertEqual(controller.error, "")

        scene[native_history.NATIVE_HISTORY_RECOVERY_KEY] = recovery_token
        controller.sync("redo")
        self.assertTrue(controller.requires_native_undo)
        self.assertIn("Redo restored", controller.error)

        del scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        controller.sync("undo")
        self.assertFalse(controller.requires_native_undo)
        self.assertEqual(controller.error, "")

    def test_failed_commit_rollback_requires_proven_native_undo(self):
        scene = _Scene()
        native_history = _load_native_history(scene)
        controller = native_history.NativeHistoryController()
        session = _Session()
        controller.register(lambda: session, lambda _restore: None, lambda: None)
        controller.prepare(session, scene, "leaf_operation")
        session.value = "after"
        host = {"geometry": "after"}

        original_marker = controller._marker
        controller._marker = lambda owner: (
            None
            if native_history.NATIVE_HISTORY_MARKER_KEY in owner
            else original_marker(owner)
        )

        with self.assertRaisesRegex(
            native_history.NativeUndoRequiredError,
            "use Blender native Undo",
        ):
            controller.commit(
                session,
                rollback=lambda: (_ for _ in ()).throw(RuntimeError("rollback failed")),
                recovery_probe=lambda: host["geometry"] == "before",
            )

        recovery_token = scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        self.assertTrue(controller.requires_native_undo)
        controller._marker = original_marker
        controller.sync("redo")
        self.assertTrue(controller.requires_native_undo)
        del scene[native_history.NATIVE_HISTORY_MARKER_KEY]
        controller.sync("undo")
        self.assertTrue(controller.requires_native_undo)

        host["geometry"] = "before"
        del scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        controller.sync("undo")
        self.assertFalse(controller.requires_native_undo)
        self.assertEqual(session.value, "before")
        self.assertEqual(controller.error, "")

        scene[native_history.NATIVE_HISTORY_RECOVERY_KEY] = recovery_token
        controller.sync("redo")
        self.assertTrue(controller.requires_native_undo)
        del scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        controller.sync("undo")
        self.assertFalse(controller.requires_native_undo)

    def test_successful_rollback_with_rejected_proof_requires_native_undo(self):
        scene = _Scene()
        native_history = _load_native_history(scene)
        controller = native_history.NativeHistoryController()
        session = _Session()
        controller.register(lambda: session, lambda _restore: None, lambda: None)
        controller.prepare(session, scene, "leaf_operation")
        session.value = "after"
        host = {"geometry": "after"}
        original_checkpoint = controller._checkpoints[None]

        original_marker = controller._marker
        controller._marker = lambda owner: (
            None
            if native_history.NATIVE_HISTORY_MARKER_KEY in owner
            else original_marker(owner)
        )

        with self.assertRaisesRegex(
            native_history.NativeUndoRequiredError,
            "use Blender native Undo",
        ):
            controller.commit(
                session,
                rollback=lambda: host.update(geometry="wrong-stage"),
                recovery_probe=lambda: host["geometry"] == "before",
            )

        self.assertEqual(host["geometry"], "wrong-stage")
        self.assertEqual(session.value, "before")
        self.assertTrue(controller.requires_native_undo)
        self.assertIs(controller._checkpoints[None], original_checkpoint)
        self.assertEqual(controller._checkpoints[None].snapshot.value, "before")
        with self.assertRaisesRegex(RuntimeError, "synchronization failed"):
            controller.prepare(session, scene, "leaf_operation")

    def test_native_undo_lock_clears_only_after_session_restore_succeeds(self):
        scene = _Scene()
        native_history = _load_native_history(scene)
        controller = native_history.NativeHistoryController()
        session = _Session()
        controller.register(lambda: session, lambda _restore: None, lambda: None)
        controller.prepare(session, scene, "leaf_operation")
        host = {"geometry": "after"}
        original_marker = controller._marker
        controller._marker = lambda owner: (
            None
            if native_history.NATIVE_HISTORY_MARKER_KEY in owner
            else original_marker(owner)
        )

        with self.assertRaises(RuntimeError):
            controller.commit(
                session,
                quarantine=True,
                recovery_probe=lambda: host["geometry"] == "before",
            )

        controller._marker = original_marker
        host["geometry"] = "before"
        del scene[native_history.NATIVE_HISTORY_RECOVERY_KEY]
        original_restore = session.restore_state
        session.restore_state = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("session restore failed")
        )
        controller.sync("undo")

        self.assertTrue(controller.requires_native_undo)
        self.assertIn("session restore failed", controller.error)

        session.restore_state = original_restore
        controller.sync("undo")
        self.assertFalse(controller.requires_native_undo)
        self.assertEqual(controller.error, "")

    def test_trusted_replay_recovery_replaces_checkpoint_only_after_new_probe(self):
        scene = _Scene()
        native_history = _load_native_history(scene)
        controller = native_history.NativeHistoryController()
        session = _Session()
        controller.register(lambda: session, lambda _restore: None, lambda: None)
        controller.prepare(session, scene, "leaf_operation")
        session.value = "failed-gate"
        original_marker = controller._marker
        controller._marker = lambda owner: (
            None
            if native_history.NATIVE_HISTORY_MARKER_KEY in owner
            else original_marker(owner)
        )
        rebased_snapshot = SimpleNamespace(
            value="replayed-prefix",
            receipts=(),
            leaf_operation_runs=(),
        )

        with self.assertRaisesRegex(RuntimeError, "operation restored"):
            controller.commit(
                session,
                rollback=lambda: native_history.NativeHistoryRecovery(
                    snapshot=rebased_snapshot,
                    recovery_probe=lambda: session.value == "replayed-prefix",
                ),
                recovery_probe=lambda: False,
            )

        self.assertEqual(session.value, "replayed-prefix")
        self.assertEqual(
            controller._checkpoints[None].snapshot.value,
            "replayed-prefix",
        )
        self.assertFalse(controller.requires_native_undo)

        controller._marker = original_marker
        controller.prepare(session, scene, "leaf_operation")
        session.value = "completed"
        completed_id = controller.commit(session)
        self.assertEqual(scene[native_history.NATIVE_HISTORY_MARKER_KEY], completed_id)

        session.rejected_restore_values.add("replayed-prefix")
        del scene[native_history.NATIVE_HISTORY_MARKER_KEY]
        controller.sync("undo")

        self.assertEqual(controller.error, "")
        self.assertEqual(session.value, "before")
        self.assertEqual(controller._current_id, None)


if __name__ == "__main__":
    unittest.main()
