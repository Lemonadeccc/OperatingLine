"""Pure-Python hostile tests for the bounded UV Sphere menu proof driver."""

from __future__ import annotations

from contextlib import nullcontext
from importlib import import_module
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_menu_control_proof_test"


class _Timers:
    def __init__(self) -> None:
        self.callbacks: list[tuple[object, float]] = []

    def register(self, callback, *, first_interval: float) -> None:
        self.callbacks.append((callback, first_interval))

    def is_registered(self, callback) -> bool:
        return any(candidate == callback for candidate, _delay in self.callbacks)

    def unregister(self, callback) -> None:
        self.callbacks = [item for item in self.callbacks if item[0] != callback]


fake_bpy = ModuleType("bpy")
fake_bpy.app = SimpleNamespace(timers=_Timers(), version=(4, 5, 3), version_string="4.5.3")
fake_bpy.context = SimpleNamespace(temp_override=lambda **_kwargs: nullcontext())
fake_bpy.data = SimpleNamespace()
sys.modules["bpy"] = fake_bpy

operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
module = import_module(f"{PACKAGE_NAME}.infrastructure.menu_control_proof")


class MenuControlProofContractTests(unittest.TestCase):
    def setUp(self) -> None:
        fake_bpy.app.timers.callbacks.clear()

    def test_fixed_catalog_identity_and_arguments(self) -> None:
        proof = module.UVSphereMenuControlProof()

        self.assertEqual(module.EXECUTOR_ID, "blender.uv_sphere_menu_controls.event_simulate.v1")
        self.assertEqual(module.TARGET_PROFILE, "factory_layout_three_object_ui_scale_2")
        self.assertEqual(len(proof.operation_ids), 7)
        self.assertEqual(
            proof.expected_arguments,
            {
                "resourceId": "proof.uv_sphere.eye",
                "objectName": "OperatingLine.TutorialEye",
                "radius": 1.5,
                "location": [1.25, -2.0, 0.75],
            },
        )
        self.assertEqual(module.HISTORY_DEPTH, 8)
        self.assertEqual(module.EVENT_SIMULATE_COUNT, 146)
        self.assertEqual(module.EXPECTED_TOPOLOGY, {"vertices": 482, "edges": 992, "polygons": 512})
        self.assertEqual(module.SUPPORTED_BLENDER_VERSIONS, ((4, 5, 3), (5, 1, 1)))

    def test_public_constructor_accepts_no_event_coordinate_or_argument_policy(self) -> None:
        with self.assertRaises(TypeError):
            module.UVSphereMenuControlProof(events=[])
        with self.assertRaises(TypeError):
            module.UVSphereMenuControlProof(location=[0, 0, 0])
        with self.assertRaises(TypeError):
            module.UVSphereMenuControlProof(target_profile="anything")

        proof = module.UVSphereMenuControlProof()
        arguments = proof.expected_arguments
        arguments["objectName"] = "Injected"
        self.assertEqual(
            proof.expected_arguments["objectName"], "OperatingLine.TutorialEye"
        )
        with self.assertRaises(TypeError):
            module.EXPECTED_ARGUMENTS["radius"] = 99

    def test_authorization_and_blender_preflight_precede_steps_and_timer(self) -> None:
        calls: list[str] = []
        proof = module.UVSphereMenuControlProof()
        proof._run_blender_preflight = lambda: calls.append("blender")
        proof._build_fixed_steps = lambda: calls.append("steps")

        proof.start(
            preflight_hook=lambda: calls.append("authorization") or True,
            on_complete=lambda _payload: self.fail("unexpected completion"),
            on_failure=lambda payload: self.fail(str(payload)),
        )

        self.assertEqual(calls, ["authorization", "blender", "steps"])
        self.assertEqual(len(fake_bpy.app.timers.callbacks), 1)

    def test_rejected_preflight_schedules_no_timer_and_emits_no_input(self) -> None:
        failures: list[dict[str, object]] = []
        proof = module.UVSphereMenuControlProof()
        proof._run_blender_preflight = lambda: self.fail("Blender preflight must not run")

        proof.start(
            preflight_hook=lambda: False,
            on_complete=lambda _payload: self.fail("unexpected completion"),
            on_failure=failures.append,
        )

        self.assertEqual(fake_bpy.app.timers.callbacks, [])
        self.assertEqual(len(failures), 1)
        self.assertFalse(failures[0]["mutationStarted"])
        self.assertFalse(failures[0]["requiresUndoRecovery"])
        self.assertEqual(failures[0]["failureStatus"], "preflight_rejected")

    def test_cancel_before_first_turn_unregisters_and_emits_no_input(self) -> None:
        emitted: list[object] = []
        failures: list[dict[str, object]] = []
        proof = module.UVSphereMenuControlProof()
        proof._run_blender_preflight = lambda: None
        proof._build_fixed_steps = lambda: proof._steps.append(
            module._Step("would emit", 0.1, lambda: emitted.append("input"))
        )
        proof.start(preflight_hook=lambda: True, on_complete=lambda _payload: None, on_failure=failures.append)
        callback = proof._timer_callback

        self.assertTrue(proof.cancel("controller cancelled"))
        self.assertFalse(proof.cancel("duplicate"))
        self.assertIsNone(callback())
        self.assertEqual(emitted, [])
        self.assertEqual(fake_bpy.app.timers.callbacks, [])
        self.assertFalse(failures[0]["requiresUndoRecovery"])

    def test_continuation_authority_is_rechecked_before_every_timer_turn(self) -> None:
        authorized = True
        emitted: list[str] = []
        failures: list[dict[str, object]] = []
        proof = module.UVSphereMenuControlProof()
        proof._run_blender_preflight = lambda: None
        proof._build_fixed_steps = lambda: proof._steps.extend(
            [
                module._Step("first", 0.1, lambda: emitted.append("first")),
                module._Step("second", 0.1, lambda: emitted.append("second")),
            ]
        )
        proof.start(preflight_hook=lambda: authorized, on_complete=lambda _payload: None, on_failure=failures.append)

        self.assertEqual(proof._timer_callback(), 0.1)
        authorized = False
        self.assertIsNone(proof._timer_callback())
        self.assertEqual(emitted, ["first"])
        self.assertIn("revoked", failures[0]["error"])
        self.assertEqual(failures[0]["failureStatus"], "failed_no_mutation")

    def test_cancellation_after_possible_mutation_reports_checkpoint_recovery(self) -> None:
        failures: list[dict[str, object]] = []
        proof = module.UVSphereMenuControlProof()
        proof._on_failure = failures.append
        proof._mutation_started = True
        proof._baseline_fingerprint = "a" * 64
        original_snapshot = module._scene_snapshot
        module._scene_snapshot = lambda: {"state": "uncertain"}
        try:
            proof.cancel("event outcome uncertain")
        finally:
            module._scene_snapshot = original_snapshot

        self.assertTrue(failures[0]["requiresUndoRecovery"])
        self.assertEqual(failures[0]["failureStatus"], "failed_checkpointed")
        self.assertEqual(failures[0]["recoveryRequirement"], "native_undo_checkpoint_required")

    def test_fixed_sequence_has_observations_then_strong_observation_then_exact_history(self) -> None:
        proof = module.UVSphereMenuControlProof()
        proof._add_point = (100, 100)
        proof._mesh_point = (200, 100)
        proof._uv_sphere_point = (300, 100)
        proof._area = SimpleNamespace(x=0, y=0, width=800, height=600, regions=[])
        proof._header = SimpleNamespace(y=500)
        proof._ui_scale = 2.0
        proof._window = SimpleNamespace(screen=SimpleNamespace(areas=[]))
        proof._build_fixed_steps()
        labels = [step.label for step in proof._steps]

        self.assertLess(labels.index("observe sphere/menu operations"), labels.index("observe location"))
        self.assertLess(labels.index("observe location"), labels.index("observe scale"))
        self.assertLess(labels.index("observe scale"), labels.index("capture strong observation after operation 7"))
        strong = labels.index("capture strong observation after operation 7")
        self.assertLess(strong, labels.index("native undo 1:press"))
        self.assertEqual(sum(label.startswith("record undo ") for label in labels), 8)
        self.assertEqual(sum(label.startswith("record redo ") for label in labels), 8)
        self.assertEqual(proof._native_input_step_count, 146)

    def test_every_timer_turn_runs_inside_the_captured_view_context(self) -> None:
        overrides: list[dict[str, object]] = []

        class _Override:
            def __enter__(self):
                return None

            def __exit__(self, *_args):
                return False

        original_override = fake_bpy.context.temp_override
        fake_bpy.context.temp_override = lambda **kwargs: (
            overrides.append(kwargs) or _Override()
        )
        proof = module.UVSphereMenuControlProof()
        proof._window = object()
        proof._area = object()
        proof._region = object()
        proof._space = object()
        proof._continuation_guard = lambda: True
        proof._steps = [module._Step("inside override", 0.1, lambda: None)]
        try:
            self.assertEqual(proof._advance(), 0.1)
        finally:
            fake_bpy.context.temp_override = original_override

        self.assertEqual(
            overrides,
            [
                {
                    "window": proof._window,
                    "area": proof._area,
                    "region": proof._region,
                    "space_data": proof._space,
                }
            ],
        )

    def test_operation_summaries_are_canonical_and_cannot_skip_order(self) -> None:
        proof = module.UVSphereMenuControlProof()
        proof._record_operation(0)
        with self.assertRaisesRegex(RuntimeError, "canonical and ordered"):
            proof._record_operation(2)
        for index in range(1, 7):
            proof._record_operation(index)

        self.assertEqual([item["operationId"] for item in proof._operation_summaries], list(module.OPERATION_IDS))
        self.assertEqual(proof._operation_summaries[4]["parameters"], {"value": [1.25, -2.0, 0.75]})
        self.assertEqual(proof._operation_summaries[5]["parameters"], {"value": [1.5, 1.5, 1.5]})

    def test_source_forbids_direct_modeling_property_writes_and_managed_claims(self) -> None:
        source = Path(module.__file__).read_text(encoding="utf-8")

        self.assertIn("event_simulate", source)
        for forbidden in (
            "bpy.ops.mesh.primitive_uv_sphere_add",
            ".location =",
            ".scale =",
            ".name =",
            "managedActionExecuted\": True",
            "managedReceiptCreated\": True",
            "managed_action",
            "managed_receipt",
        ):
            self.assertNotIn(forbidden, source)

    def test_evidence_claims_explicitly_deny_managed_execution(self) -> None:
        self.assertEqual(
            module.execution_evidence_claims(),
            {
                "evidenceClass": "blender_event_simulation",
                "osHidInput": False,
                "managedActionResult": "not_executed",
                "managedIdentityVerified": False,
            },
        )


if __name__ == "__main__":
    unittest.main()
