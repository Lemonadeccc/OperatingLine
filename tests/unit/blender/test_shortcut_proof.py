"""Pure-Python contract tests for the bounded Blender shortcut proof driver."""

from __future__ import annotations

from importlib import import_module
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_shortcut_proof_test"


class _Timers:
    def __init__(self) -> None:
        self.callbacks = []

    def register(self, callback, *, first_interval: float) -> None:
        self.callbacks.append((callback, first_interval))

    def is_registered(self, callback) -> bool:
        return any(candidate == callback for candidate, _delay in self.callbacks)

    def unregister(self, callback) -> None:
        self.callbacks = [
            (candidate, delay)
            for candidate, delay in self.callbacks
            if candidate != callback
        ]


fake_bpy = ModuleType("bpy")
fake_bpy.app = SimpleNamespace(timers=_Timers(), version_string="test")
fake_bpy.context = SimpleNamespace()
sys.modules["bpy"] = fake_bpy

operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
module = import_module(f"{PACKAGE_NAME}.infrastructure.shortcut_proof")
CONTEXT = {
    "windowId": "123",
    "areaType": "VIEW_3D",
    "regionType": "WINDOW",
    "mode": "OBJECT",
}
STACK_HASH = "a" * 64
IDENTITY = {
    "proof_id": "00000000-0000-4000-8000-000000000001",
    "request_id": "00000000-0000-4000-8000-000000000002",
    "delivery_id": "00000000-0000-4000-8000-000000000003",
    "binding_content_sha256": "b" * 64,
}
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


def event(event_type: str, value: str, *, ctrl: bool = False) -> dict[str, object]:
    return {
        "type": event_type,
        "value": value,
        "ctrl": ctrl,
        "shift": False,
        "point": {"x": 400, "y": 300, "role": "viewport_center"},
    }


def driver(level: int, **kwargs: object):
    return module.SubdivisionSurfaceF9ShortcutProof(level, **IDENTITY, **kwargs)


def factory_cube_object():
    coordinates = [tuple(point) for point in module._FACTORY_CUBE_VERTICES]
    coordinate_index = {point: index for index, point in enumerate(coordinates)}
    faces = [
        tuple(
            coordinate_index[tuple(point)]
            for point in face
        )
        for face in module._FACTORY_CUBE_FACES
    ]
    return SimpleNamespace(
        data=SimpleNamespace(
            vertices=[SimpleNamespace(co=point) for point in coordinates],
            edges=[
                SimpleNamespace(
                    vertices=(coordinate_index[tuple(left)], coordinate_index[tuple(right)])
                )
                for left, right in module._FACTORY_CUBE_EDGES
            ],
            polygons=[SimpleNamespace(vertices=face) for face in faces],
            shape_keys=None,
            has_custom_normals=False,
            attributes=[
                SimpleNamespace(
                    name="UVMap",
                    domain="CORNER",
                    data_type="FLOAT2",
                    data=[SimpleNamespace(vector=uv) for uv in module._FACTORY_CUBE_UV_MAP],
                ),
                SimpleNamespace(
                    name="sharp_face",
                    domain="FACE",
                    data_type="BOOLEAN",
                    data=[SimpleNamespace(value=True) for _index in range(6)],
                ),
            ],
        ),
        location=(0.0, 0.0, 0.0),
        rotation_mode="XYZ",
        rotation_euler=(0.0, 0.0, 0.0),
        rotation_quaternion=(1.0, 0.0, 0.0, 0.0),
        rotation_axis_angle=(0.0, 0.0, 1.0, 0.0),
        scale=(1.0, 1.0, 1.0),
        delta_location=(0.0, 0.0, 0.0),
        delta_rotation_euler=(0.0, 0.0, 0.0),
        delta_rotation_quaternion=(1.0, 0.0, 0.0, 0.0),
        delta_scale=(1.0, 1.0, 1.0),
        parent=None,
        parent_type="OBJECT",
        parent_vertices=(0, 0, 0),
        constraints=[],
    )


class ShortcutProofContractTests(unittest.TestCase):
    def test_canonical_hash_matches_protocol_shared_vector(self) -> None:
        self.assertEqual(
            module._canonical_sha256(CANONICAL_HASH_VECTOR),
            CANONICAL_HASH_VECTOR_SHA256,
        )

    def test_executor_and_evidence_claims_are_fixed(self) -> None:
        self.assertEqual(
            module.EXECUTOR_ID,
            "blender.subdivision_surface_f9.event_simulate.v1",
        )
        self.assertEqual(module.TARGET_PROFILE, "factory_cube_8_12_6")
        self.assertEqual(
            module.execution_evidence_claims(),
            {
                "evidenceClass": "blender_event_simulation",
                "osHidInput": False,
                "managedActionResult": "not_executed",
                "managedIdentityVerified": False,
            },
        )

    def test_target_level_is_the_only_public_execution_parameter(self) -> None:
        proof_driver = driver(2)

        self.assertEqual(proof_driver.target_level, 2)
        self.assertEqual(proof_driver.executor_id, module.EXECUTOR_ID)
        self.assertEqual(
            proof_driver.operation_ids,
            (
                "shortcut.add_subdivision_surface_level_one",
                "shortcut.open_adjust_last_operation",
                "shortcut.set_viewport_level",
                "shortcut.close_adjust_last_operation",
            ),
        )
        with self.assertRaisesRegex(ValueError, "target level"):
            driver(4)
        with self.assertRaises(TypeError):
            driver(2, events=[])
        with self.assertRaises(TypeError):
            driver(2, target_profile="arbitrary_mesh")

    def test_operation_receipts_form_a_canonical_hash_chain(self) -> None:
        first = module.build_operation_receipt(
            **IDENTITY,
            operation_index=0,
            operation_id="shortcut.add_subdivision_surface_level_one",
            event_evidence=(
                event("ONE", "PRESS", ctrl=True),
                event("ONE", "RELEASE", ctrl=True),
            ),
            observation={"modifierCount": 1, "level": 1},
            previous_receipt_sha256=None,
            context=CONTEXT,
            operator_stack_before_sha256=STACK_HASH,
            operator_stack_after_sha256=STACK_HASH,
        )
        second = module.build_operation_receipt(
            **IDENTITY,
            operation_index=1,
            operation_id="shortcut.open_adjust_last_operation",
            event_evidence=(
                event("F9", "PRESS"),
                event("F9", "RELEASE"),
            ),
            observation={"operatorId": "OBJECT_OT_subdivision_set"},
            previous_receipt_sha256=first["contentSha256"],
            context=CONTEXT,
            operator_stack_before_sha256=STACK_HASH,
            operator_stack_after_sha256=STACK_HASH,
        )

        self.assertIsNone(first["previousReceiptContentSha256"])
        self.assertEqual(
            second["previousReceiptContentSha256"], first["contentSha256"]
        )
        self.assertTrue(module.verify_operation_receipt_chain((first, second)))
        self.assertEqual(
            {
                key: first[key]
                for key in (
                    "proofId",
                    "requestId",
                    "deliveryId",
                    "bindingContentSha256",
                )
            },
            {
                "proofId": IDENTITY["proof_id"],
                "requestId": IDENTITY["request_id"],
                "deliveryId": IDENTITY["delivery_id"],
                "bindingContentSha256": IDENTITY["binding_content_sha256"],
            },
        )

        tampered = json.loads(json.dumps((first, second)))
        tampered[0]["eventEvidence"][0]["ctrl"] = False
        self.assertFalse(module.verify_operation_receipt_chain(tampered))

        cross_identity = json.loads(json.dumps((first, second)))
        second_body = dict(cross_identity[1])
        second_body.pop("contentSha256")
        second_body["deliveryId"] = "00000000-0000-4000-8000-000000000099"
        cross_identity[1] = {
            **second_body,
            "contentSha256": module._canonical_sha256(second_body),
        }
        self.assertFalse(module.verify_operation_receipt_chain(cross_identity))

    def test_chain_rejects_wrong_order_or_unknown_operation(self) -> None:
        receipt = module.build_operation_receipt(
            **IDENTITY,
            operation_index=1,
            operation_id="shortcut.open_adjust_last_operation",
            event_evidence=(
                event("F9", "PRESS"),
                event("F9", "RELEASE"),
            ),
            observation={},
            previous_receipt_sha256="a" * 64,
            context=CONTEXT,
            operator_stack_before_sha256=STACK_HASH,
            operator_stack_after_sha256=STACK_HASH,
        )
        self.assertFalse(module.verify_operation_receipt_chain((receipt,)))
        with self.assertRaisesRegex(ValueError, "operation"):
            module.build_operation_receipt(
                **IDENTITY,
                operation_index=0,
                operation_id="shortcut.server_supplied_operation",
                event_evidence=({},),
                observation={},
                previous_receipt_sha256=None,
                context=CONTEXT,
                operator_stack_before_sha256=STACK_HASH,
                operator_stack_after_sha256=STACK_HASH,
            )
        with self.assertRaisesRegex(ValueError, "event count"):
            module.build_operation_receipt(
                **IDENTITY,
                operation_index=0,
                operation_id="shortcut.add_subdivision_surface_level_one",
                event_evidence=({},),
                observation={},
                previous_receipt_sha256=None,
                context=CONTEXT,
                operator_stack_before_sha256=STACK_HASH,
                operator_stack_after_sha256=STACK_HASH,
            )

    def test_production_driver_contains_no_direct_modeling_or_managed_calls(self) -> None:
        source = Path(module.__file__).read_text(encoding="utf-8")

        self.assertIn("event_simulate", source)
        self.assertNotIn("bpy.ops.operating_line.next", source)
        self.assertNotIn("bpy.ops.object.subdivision_set", source)
        self.assertNotIn("modifier.levels =", source)
        self.assertNotIn("modifiers.new", source)

    def test_load_post_uses_document_replacement_abandon_path(self) -> None:
        addon_source = (PACKAGE_ROOT / "__init__.py").read_text(encoding="utf-8")

        self.assertIn(
            "previous.unregister_timer(document_replaced=True)", addon_source
        )

    def test_required_preflight_hook_runs_before_blender_preflight_and_timer(self) -> None:
        calls = []
        completed = []
        failed = []
        fake_bpy.app.timers.callbacks.clear()
        driver = globals()["driver"](2)
        driver._run_blender_preflight = lambda: calls.append("blender")
        driver._build_fixed_steps = lambda: calls.append("steps")

        driver.start(
            preflight_hook=lambda: calls.append("authorization") or True,
            on_complete=completed.append,
            on_failure=failed.append,
        )

        self.assertEqual(calls, ["authorization", "blender", "steps"])
        self.assertEqual(completed, [])
        self.assertEqual(failed, [])
        self.assertEqual(len(fake_bpy.app.timers.callbacks), 1)

    def test_strong_observation_is_scheduled_after_fourth_receipt(self) -> None:
        proof_driver = driver(2)

        proof_driver._build_fixed_steps()
        labels = [step.label for step in proof_driver._steps]

        fourth_receipt = (
            "receipt:shortcut.close_adjust_last_operation"
        )
        self.assertLess(labels.index(fourth_receipt), labels.index("capture strong observation"))
        self.assertLess(labels.index("capture strong observation"), labels.index("native undo:press"))

    def test_rejected_preflight_hook_schedules_no_input(self) -> None:
        failures = []
        fake_bpy.app.timers.callbacks.clear()
        driver = globals()["driver"](1)

        driver.start(
            preflight_hook=lambda: False,
            on_complete=lambda _payload: self.fail("unexpected completion"),
            on_failure=failures.append,
        )

        self.assertEqual(len(failures), 1)
        self.assertIn("authorization hook rejected", failures[0]["error"])
        self.assertIs(failures[0]["mutationStarted"], False)
        self.assertIsNone(failures[0]["lastCompletedOperation"])
        self.assertIs(failures[0]["requiresUndoRecovery"], False)
        self.assertNotIn("traceback", failures[0])
        self.assertEqual(failures[0]["failureStatus"], "preflight_rejected")
        self.assertEqual(
            failures[0]["nativeHistory"]["status"], "preflight_rejected"
        )
        self.assertIs(failures[0]["operationReceiptPrefixVerified"], True)
        self.assertIs(failures[0]["operationReceiptChainComplete"], False)
        self.assertIs(failures[0]["operationReceiptChainVerified"], False)
        self.assertEqual(fake_bpy.app.timers.callbacks, [])

    def test_cancel_before_first_step_unregisters_timer_and_emits_no_input(self) -> None:
        failures = []
        simulated_events = []
        fake_bpy.app.timers.callbacks.clear()
        proof_driver = driver(1)
        proof_driver._run_blender_preflight = lambda: None
        proof_driver._build_fixed_steps = lambda: proof_driver._steps.append(
            module._Step("would dispatch", 0.1, lambda: simulated_events.append("input"))
        )
        proof_driver.start(
            preflight_hook=lambda: True,
            on_complete=lambda _payload: self.fail("unexpected completion"),
            on_failure=failures.append,
        )
        callback = proof_driver._timer_callback

        self.assertTrue(proof_driver.cancel("addon disabled"))
        self.assertFalse(proof_driver.cancel("duplicate cancellation"))
        self.assertEqual(fake_bpy.app.timers.callbacks, [])
        self.assertIsNone(callback())
        self.assertEqual(simulated_events, [])
        self.assertEqual(len(failures), 1)
        self.assertIs(failures[0]["mutationStarted"], False)
        self.assertIs(failures[0]["requiresUndoRecovery"], False)

    def test_cancel_after_first_mutation_stops_input_and_requires_native_undo(self) -> None:
        class _Override:
            def __enter__(self):
                return None

            def __exit__(self, _type, _value, _traceback):
                return False

        failures = []
        simulated_events = []
        fake_bpy.app.timers.callbacks.clear()
        fake_bpy.context.temp_override = lambda **_kwargs: _Override()
        fake_bpy.context.window_manager = SimpleNamespace(operators=[])
        proof_driver = driver(2)
        proof_driver._run_blender_preflight = lambda: None
        proof_driver._window = SimpleNamespace(
            event_simulate=lambda **event_payload: simulated_events.append(event_payload)
        )
        proof_driver._center = (400, 300)
        proof_driver._baseline_scene_snapshot = {"state": "baseline"}
        proof_driver._baseline_scene_fingerprint_sha256 = "a" * 64
        proof_driver._current_scene_fingerprint = lambda: (
            {"state": "mutated"},
            "b" * 64,
        )

        def build_steps():
            proof_driver._append_event(
                "mutation", "ONE", ctrl=True, operation_index=0
            )
            proof_driver._append_event("must not run", "F9")

        proof_driver._build_fixed_steps = build_steps
        proof_driver.start(
            preflight_hook=lambda: True,
            on_complete=lambda _payload: self.fail("unexpected completion"),
            on_failure=failures.append,
        )
        callback = proof_driver._timer_callback

        self.assertEqual(callback(), 0.1)
        self.assertEqual(len(simulated_events), 1)
        self.assertTrue(proof_driver.cancel("controller replacement"))
        self.assertIsNone(callback())
        self.assertEqual(len(simulated_events), 1)
        self.assertEqual(fake_bpy.app.timers.callbacks, [])
        self.assertEqual(len(failures), 1)
        self.assertIs(failures[0]["mutationStarted"], True)
        self.assertIs(failures[0]["requiresUndoRecovery"], True)
        self.assertEqual(failures[0]["failureStatus"], "failed_checkpointed")
        self.assertEqual(
            failures[0]["currentSceneFingerprintSha256"], "b" * 64
        )

    def test_abandon_after_document_replacement_never_reads_new_scene(self) -> None:
        failures = []
        simulated_events = []
        fake_bpy.app.timers.callbacks.clear()
        proof_driver = driver(2)
        proof_driver._run_blender_preflight = lambda: None
        proof_driver._build_fixed_steps = lambda: proof_driver._steps.append(
            module._Step("must not run", 0.1, lambda: simulated_events.append("input"))
        )
        proof_driver._current_scene_fingerprint = lambda: self.fail(
            "replacement Scene must not be inspected"
        )
        proof_driver.start(
            preflight_hook=lambda: True,
            on_complete=lambda _payload: self.fail("unexpected completion"),
            on_failure=failures.append,
        )
        callback = proof_driver._timer_callback

        self.assertTrue(proof_driver.abandon())
        self.assertFalse(proof_driver.abort())
        self.assertIsNone(callback())
        self.assertEqual(fake_bpy.app.timers.callbacks, [])
        self.assertEqual(simulated_events, [])
        self.assertEqual(failures, [])

    def test_revoked_continuation_guard_stops_after_first_mutation(self) -> None:
        class _Override:
            def __enter__(self):
                return None

            def __exit__(self, _type, _value, _traceback):
                return False

        authorized = True
        failures = []
        simulated_events = []
        fake_bpy.app.timers.callbacks.clear()
        fake_bpy.context.temp_override = lambda **_kwargs: _Override()
        fake_bpy.context.window_manager = SimpleNamespace(operators=[])
        proof_driver = driver(3)
        proof_driver._run_blender_preflight = lambda: None
        proof_driver._window = SimpleNamespace(
            event_simulate=lambda **event_payload: simulated_events.append(event_payload)
        )
        proof_driver._center = (400, 300)
        proof_driver._baseline_scene_snapshot = {"state": "baseline"}
        proof_driver._baseline_scene_fingerprint_sha256 = "a" * 64
        proof_driver._current_scene_fingerprint = lambda: (
            {"state": "mutated"},
            "b" * 64,
        )

        def build_steps():
            proof_driver._append_event(
                "mutation", "ONE", ctrl=True, operation_index=0
            )
            proof_driver._append_event("revoked input", "F9")

        proof_driver._build_fixed_steps = build_steps
        proof_driver.start(
            preflight_hook=lambda: authorized,
            on_complete=lambda _payload: self.fail("unexpected completion"),
            on_failure=failures.append,
        )
        callback = proof_driver._timer_callback
        self.assertEqual(callback(), 0.1)
        authorized = False

        self.assertIsNone(callback())
        self.assertEqual(len(simulated_events), 1)
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["failureStatus"], "failed_checkpointed")
        self.assertIs(failures[0]["requiresUndoRecovery"], True)
        self.assertIn("authorization was revoked", failures[0]["error"])
        self.assertEqual(fake_bpy.app.timers.callbacks, [])

    def test_mutation_event_exception_is_conservatively_undo_required(self) -> None:
        class _Override:
            def __enter__(self):
                return None

            def __exit__(self, _type, _value, _traceback):
                return False

        failures = []
        fake_bpy.app.timers.callbacks.clear()
        fake_bpy.context.temp_override = lambda **_kwargs: _Override()
        fake_bpy.context.window_manager = SimpleNamespace(operators=[])
        proof_driver = driver(1)
        proof_driver._run_blender_preflight = lambda: None
        proof_driver._window = SimpleNamespace(
            event_simulate=lambda **_payload: (_ for _ in ()).throw(
                RuntimeError("injected event failure")
            )
        )
        proof_driver._center = (400, 300)
        proof_driver._baseline_scene_snapshot = {"state": "baseline"}
        proof_driver._baseline_scene_fingerprint_sha256 = "a" * 64
        proof_driver._current_scene_fingerprint = lambda: (
            {"state": "unknown-after-dispatch"},
            "b" * 64,
        )
        proof_driver._build_fixed_steps = lambda: proof_driver._append_event(
            "mutation", "ONE", ctrl=True, operation_index=0
        )
        proof_driver.start(
            preflight_hook=lambda: True,
            on_complete=lambda _payload: self.fail("unexpected completion"),
            on_failure=failures.append,
        )

        self.assertIsNone(proof_driver._timer_callback())
        self.assertEqual(len(failures), 1)
        self.assertIs(failures[0]["mutationStarted"], True)
        self.assertIs(failures[0]["requiresUndoRecovery"], True)
        self.assertEqual(failures[0]["failureStatus"], "failed_checkpointed")

    def test_mutation_event_exception_at_unchanged_baseline_needs_no_undo(self) -> None:
        class _Override:
            def __enter__(self):
                return None

            def __exit__(self, _type, _value, _traceback):
                return False

        failures = []
        fake_bpy.app.timers.callbacks.clear()
        fake_bpy.context.temp_override = lambda **_kwargs: _Override()
        fake_bpy.context.window_manager = SimpleNamespace(operators=[])
        proof_driver = driver(1)
        proof_driver._run_blender_preflight = lambda: None
        proof_driver._window = SimpleNamespace(
            event_simulate=lambda **_payload: (_ for _ in ()).throw(
                RuntimeError("rejected before Blender changed the scene")
            )
        )
        proof_driver._center = (400, 300)
        proof_driver._baseline_scene_snapshot = {"state": "baseline"}
        proof_driver._baseline_scene_fingerprint_sha256 = "a" * 64
        proof_driver._current_scene_fingerprint = lambda: (
            {"state": "baseline"},
            "a" * 64,
        )
        proof_driver._build_fixed_steps = lambda: proof_driver._append_event(
            "mutation", "ONE", ctrl=True, operation_index=0
        )
        proof_driver.start(
            preflight_hook=lambda: True,
            on_complete=lambda _payload: self.fail("unexpected completion"),
            on_failure=failures.append,
        )

        self.assertIsNone(proof_driver._timer_callback())
        self.assertEqual(len(failures), 1)
        self.assertIs(failures[0]["mutationStarted"], True)
        self.assertIs(failures[0]["requiresUndoRecovery"], False)
        self.assertEqual(failures[0]["failureStatus"], "failed_restored")

    def test_scene_fingerprint_is_canonical_and_pointer_free(self) -> None:
        baseline = {
            "formatVersion": "1.0.0",
            "target": {"objectName": "Cube", "objectType": "MESH", "meshName": "Cube"},
            "context": {
                "mode": "OBJECT",
                "activeObjectName": "Cube",
                "selectedObjectNames": ["Cube"],
            },
            "mesh": {
                "baseTopology": {"vertices": 8, "edges": 12, "polygons": 6},
                "evaluatedTopology": {"vertices": 8, "edges": 12, "polygons": 6},
            },
            "modifiers": [],
        }
        reordered = dict(reversed(tuple(baseline.items())))

        self.assertEqual(
            module.compute_shortcut_scene_fingerprint_sha256(baseline),
            module.compute_shortcut_scene_fingerprint_sha256(reordered),
        )
        changed = json.loads(json.dumps(baseline))
        changed["modifiers"] = [{"type": "SUBSURF", "levels": 2}]
        self.assertNotEqual(
            module.compute_shortcut_scene_fingerprint_sha256(baseline),
            module.compute_shortcut_scene_fingerprint_sha256(changed),
        )
        self.assertNotIn("pointer", json.dumps(baseline).lower())

    def test_factory_cube_snapshot_is_pointer_free_and_canonical(self) -> None:
        snapshot = module.build_factory_cube_canonical_snapshot(factory_cube_object())

        module.validate_factory_cube_canonical_snapshot(snapshot)
        self.assertNotIn("pointer", json.dumps(snapshot).lower())
        self.assertEqual(len(snapshot["geometry"]["vertices"]), 8)
        self.assertEqual(len(snapshot["geometry"]["edgeEndpoints"]), 12)
        self.assertEqual(len(snapshot["geometry"]["quadFaces"]), 6)
        self.assertIsNone(snapshot["geometry"]["shapeKeys"])
        self.assertIs(snapshot["geometry"]["hasCustomNormals"], False)
        self.assertEqual(
            [attribute["name"] for attribute in snapshot["geometry"]["subdivisionAttributes"]],
            ["UVMap", "sharp_face"],
        )

    def test_factory_cube_validator_rejects_8_12_6_lookalikes_and_nonidentity(self) -> None:
        snapshot = module.build_factory_cube_canonical_snapshot(factory_cube_object())
        mutations = {
            "identity transform": lambda candidate: candidate["transform"].update(
                {"deltaScale": [1.0, 1.0, 2.0]}
            ),
            "vertices": lambda candidate: candidate["geometry"]["vertices"][0].__setitem__(
                0, -0.5
            ),
            "edges": lambda candidate: candidate["geometry"]["edgeEndpoints"][0].__setitem__(
                1, [1.0, 1.0, 1.0]
            ),
            "faces": lambda candidate: candidate["geometry"]["quadFaces"][0].__setitem__(
                3, [1.0, 1.0, 1.0]
            ),
            "shape keys": lambda candidate: candidate["geometry"].update(
                {"shapeKeys": {"name": "Key", "keyBlockNames": ["Basis"]}}
            ),
            "custom normals": lambda candidate: candidate["geometry"].update(
                {"hasCustomNormals": True}
            ),
            "subdivision attributes": lambda candidate: candidate["geometry"][
                "subdivisionAttributes"
            ].append(
                {
                    "name": "crease_edge",
                    "domain": "EDGE",
                    "dataType": "FLOAT",
                    "data": [1.0] + [0.0] * 11,
                }
            ),
        }
        for message, mutate in mutations.items():
            with self.subTest(message=message):
                candidate = json.loads(json.dumps(snapshot))
                mutate(candidate)
                with self.assertRaisesRegex(RuntimeError, message):
                    module.validate_factory_cube_canonical_snapshot(candidate)

    def test_mutated_failure_requires_explicit_native_undo_recovery(self) -> None:
        failures = []
        driver = globals()["driver"](2)
        driver._on_failure = failures.append
        driver._mutation_started = True
        driver._baseline_scene_fingerprint_sha256 = "a" * 64
        driver._current_scene_fingerprint = lambda: ({"state": "mutated"}, "b" * 64)
        driver._current_label = "receipt:shortcut.add_subdivision_surface_level_one"

        driver._fail(RuntimeError("observation rejected"))

        self.assertEqual(len(failures), 1)
        self.assertIs(failures[0]["mutationStarted"], True)
        self.assertIsNone(failures[0]["lastCompletedOperation"])
        self.assertIs(failures[0]["requiresUndoRecovery"], True)
        self.assertEqual(
            failures[0]["nativeHistory"],
            {
                "status": "failed_checkpointed",
                "availability": "failed_checkpointed",
                "reason": "The shortcut mutation remains and requires native Undo recovery.",
            },
        )
        self.assertEqual(failures[0]["failureStatus"], "failed_checkpointed")
        self.assertEqual(failures[0]["currentSceneSnapshot"], {"state": "mutated"})
        self.assertEqual(failures[0]["currentSceneFingerprintSha256"], "b" * 64)
        self.assertNotIn("traceback", failures[0])
        self.assertIs(failures[0]["operationReceiptPrefixVerified"], True)
        self.assertIs(failures[0]["operationReceiptChainComplete"], False)
        self.assertIs(failures[0]["operationReceiptChainVerified"], False)

    def test_mutated_failure_at_baseline_reports_failed_restored(self) -> None:
        failures = []
        driver = globals()["driver"](1)
        driver._on_failure = failures.append
        driver._mutation_started = True
        driver._baseline_scene_snapshot = {"state": "baseline"}
        driver._baseline_scene_fingerprint_sha256 = "a" * 64
        driver._current_scene_fingerprint = lambda: ({"state": "baseline"}, "a" * 64)

        driver._fail(RuntimeError("post-undo reporting failed"))

        self.assertEqual(failures[0]["failureStatus"], "failed_restored")
        self.assertIs(failures[0]["requiresUndoRecovery"], False)
        self.assertEqual(failures[0]["nativeHistory"]["status"], "failed_restored")
        self.assertEqual(failures[0]["currentSceneSnapshot"], {"state": "baseline"})
        self.assertEqual(failures[0]["currentSceneFingerprintSha256"], "a" * 64)


if __name__ == "__main__":
    unittest.main()
