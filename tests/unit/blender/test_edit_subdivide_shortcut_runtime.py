"""Contract tests for the bounded Edit Subdivide native-input runtime."""

from __future__ import annotations

import ast
from importlib import import_module
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_edit_subdivide_shortcut_runtime_test"


def _persistent(callback):
    return callback


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
proof = import_module(f"{PACKAGE_NAME}.infrastructure.edit_subdivide_shortcut_proof")
history = import_module(
    f"{PACKAGE_NAME}.infrastructure.edit_subdivide_shortcut_history"
)


IDENTITY = {
    "proof_id": "00000000-0000-4000-8000-000000000001",
    "request_id": "00000000-0000-4000-8000-000000000002",
    "delivery_id": "00000000-0000-4000-8000-000000000003",
    "binding_content_sha256": "b" * 64,
}


class EditSubdivideShortcutRuntimeTests(unittest.TestCase):
    def test_executor_owns_exact_nine_operations_and_four_step_history(self) -> None:
        self.assertEqual(len(proof.OPERATION_IDS), 9)
        self.assertEqual(proof.NATIVE_UNDO_DEPTH, 4)
        self.assertEqual(proof.NATIVE_REDO_DEPTH, 4)
        self.assertEqual(proof.OPERATION_IDS[-1], "shortcut.return_to_object_mode")

    def test_driver_canonicalizes_parameter_text_like_protocol_string(self) -> None:
        driver = proof.EditSubdivideF3F9ShortcutProof(3, 1.0, **IDENTITY)
        self.assertEqual(driver.cuts_text, "3")
        self.assertEqual(driver.smooth_text, "1")
        with self.assertRaisesRegex(ValueError, "cuts"):
            proof.EditSubdivideF3F9ShortcutProof(0, 0.5, **IDENTITY)
        with self.assertRaisesRegex(ValueError, "smooth"):
            proof.EditSubdivideF3F9ShortcutProof(2, float("nan"), **IDENTITY)

    def test_mutation_lease_is_required_before_timer_registration(self) -> None:
        driver = proof.EditSubdivideF3F9ShortcutProof(2, 0.5, **IDENTITY)
        order: list[str] = []
        driver._preflight = lambda: order.append("preflight")
        driver._build_steps = lambda: order.append("steps")
        failures: list[dict[str, object]] = []

        driver.start(
            preflight_hook=lambda: order.append("authority") or True,
            pre_mutation_hook=lambda: order.append("lease") or False,
            on_complete=lambda _evidence: None,
            on_failure=failures.append,
        )

        self.assertEqual(order, ["authority", "preflight", "steps", "lease"])
        self.assertFalse(driver._timer_registered)
        self.assertEqual(failures[0]["failureStatus"], "preflight_rejected")

    def test_runtime_contains_no_bpy_operator_mutation_call(self) -> None:
        source_path = Path(proof.__file__)
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        forbidden = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Attribute):
                continue
            value = node.value
            if isinstance(value, ast.Attribute) and isinstance(value.value, ast.Name):
                if value.value.id == "bpy" and value.attr == "ops":
                    forbidden.append(node.attr)
        self.assertEqual(forbidden, [])
        self.assertIn("event_simulate", source_path.read_text(encoding="utf-8"))

    def test_v2_loader_does_not_read_v1_marker(self) -> None:
        scene = {
            "_operating_line_shortcut_proof_history_v1": "not-v2-json",
        }
        self.assertIsNone(
            history.EditSubdivideShortcutHistoryController._read_marker(scene)
        )
        self.assertEqual(
            history.EDIT_SUBDIVIDE_SHORTCUT_HISTORY_MARKER_KEY,
            "_operating_line_shortcut_proof_history_v2",
        )

    def test_v2_history_requires_four_undo_and_redo_boundaries(self) -> None:
        # Use a dict subclass because persisted markers use Blender ID-property syntax.
        class Scene(dict):
            session_uid = 17

        scene = Scene()
        controller = history.EditSubdivideShortcutHistoryController()
        results: list[dict[str, object]] = []
        controller._registered = True
        controller._restored_builder = lambda transition: {"status": transition.status}
        controller._reapplied_builder = lambda transition: {"status": transition.status}
        controller._result_callback = results.append
        entry = history._Entry(
            "00000000-0000-4000-8000-000000000010",
            None,
            "00000000-0000-4000-8000-000000000011",
            IDENTITY["proof_id"],
            "00000000-0000-4000-8000-000000000012",
            "tutorial.cube",
            17,
            101,
            202,
            "success",
            "a" * 64,
            "b" * 64,
            {},
            {},
            "c" * 64,
            "d" * 64,
            proof.OPERATION_IDS[-1],
            "e" * 64,
            "2026-08-20T12:00:00Z",
            {"status": "succeeded"},
        )
        controller._current = entry
        controller._locked = True
        fake_bpy.data.scenes = [scene]
        fingerprints = iter(
            [
                "1" * 64,
                "2" * 64,
                "3" * 64,
                "a" * 64,
                "4" * 64,
                "5" * 64,
                "6" * 64,
                "b" * 64,
            ]
        )
        with patch.object(
            history,
            "build_edit_subdivide_scene_snapshot",
            side_effect=lambda: next(fingerprints),
        ), patch.object(
            history,
            "compute_edit_subdivide_scene_fingerprint_sha256",
            side_effect=lambda value: value,
        ):
            for _ in range(4):
                controller.sync("undo")
            self.assertFalse(controller.mutation_locked)
            for _ in range(4):
                controller.sync("redo")
        self.assertTrue(controller.mutation_locked)
        self.assertEqual(
            results, [{"status": "restored"}, {"status": "reapplied_locked"}]
        )
        assert controller._current is not None
        self.assertEqual(len(controller._current.transition_results), 2)
        controller.acknowledge_transition_results(
            [history._canonical_sha256(results[0])]
        )
        assert controller._current is not None
        self.assertEqual(
            controller._current.transition_results,
            ({"status": "reapplied_locked"},),
        )


if __name__ == "__main__":
    unittest.main()
