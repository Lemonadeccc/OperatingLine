"""Focused pure-Python tests for Companion menu-control evidence shaping."""

from __future__ import annotations

from datetime import datetime, timezone
from importlib import import_module
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
import uuid


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_menu_control_companion_test"

fake_bpy = ModuleType("bpy")
fake_bpy.app = SimpleNamespace(timers=SimpleNamespace(), version_string="4.5.3")
fake_bpy.context = SimpleNamespace()
sys.modules.setdefault("bpy", fake_bpy)

package = ModuleType(PACKAGE_NAME)
package.__path__ = [str(PACKAGE_ROOT)]
package.get_session = lambda: None
sys.modules[PACKAGE_NAME] = package
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure

blender_actions = ModuleType(f"{PACKAGE_NAME}.infrastructure.blender_actions")
blender_actions.action_registry = lambda _root: {}
sys.modules[blender_actions.__name__] = blender_actions
observations = ModuleType(f"{PACKAGE_NAME}.infrastructure.observations")
observations.evaluate_observations = lambda *_args, **_kwargs: []
sys.modules[observations.__name__] = observations

companion = import_module(f"{PACKAGE_NAME}.application.companion")


class _Transport:
    def __init__(self) -> None:
        self.progress = []
        self.results = []
        self.recovery_acks = []

    def submit_menu_control_proof_progress(self, payload):
        self.progress.append(payload)

    def submit_menu_control_proof_result(self, payload):
        self.results.append(payload)

    def submit_menu_control_proof_recovery_ack(self, payload):
        self.recovery_acks.append(payload)


class _MenuHistory:
    def __init__(
        self,
        *,
        mutation_locked: bool = False,
        pending: dict | None = None,
        reconciliation_ack: dict | None = None,
    ) -> None:
        self.mutation_locked = mutation_locked
        self.pending = pending
        self.reconciliation_ack = reconciliation_ack
        self.reconciliation_calls = []

    def pending_terminal_result(self):
        return self.pending

    def build_terminal_reconciliation_ack(self, scene, delivery):
        self.reconciliation_calls.append((scene, delivery))
        if self.reconciliation_ack is None:
            raise RuntimeError("no persisted terminal outbox")
        return self.reconciliation_ack


def _delivery():
    dispatched = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "requestId": str(uuid.uuid4()),
        "proofId": str(uuid.uuid4()),
        "deliveryId": str(uuid.uuid4()),
        "bindingContentSha256": "a" * 64,
        "operationIds": [
            "workspace.layout", "menu.add", "menu.mesh", "operator.uv_sphere",
            "control.location", "control.scale", "control.object_name",
        ],
        "dispatchedAt": dispatched,
        "lease": {"expiresAt": dispatched},
    }


def _summaries():
    paths = (
        ["Layout"], ["Layout", "Add"], ["Layout", "Add", "Mesh"],
        ["Layout", "Add", "Mesh", "UV Sphere"],
        ["Sidebar", "Item", "Transform", "Location"],
        ["Sidebar", "Item", "Transform", "Scale"],
        ["Properties", "Object", "Name"],
    )
    parameters = (
        {}, {}, {}, {"radius": 1.0}, {"value": [1.25, -2.0, 0.75]},
        {"value": [1.5, 1.5, 1.5]}, {"value": "OperatingLine.TutorialEye"},
    )
    return [
        {
            "operationId": operation_id,
            "status": "precondition_verified" if index == 0 else "control_executed",
            "path": paths[index],
            "parameters": parameters[index],
        }
        for index, operation_id in enumerate(_delivery()["operationIds"])
    ]


class MenuControlCompanionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.controller = companion.CompanionController.__new__(
            companion.CompanionController
        )
        self.controller._transport = _Transport()
        self.controller._shortcut_proof_driver = None
        self.controller._menu_control_proof_driver = None
        self.controller._menu_control_history = _MenuHistory()
        self.controller._menu_control_terminal_resubmitted_lease_id = None
        self.controller._pending_menu_control_terminal_reconciliation = None
        self.controller._menu_control_native_guidance_suspended = False
        self.controller._menu_control_recovery_locked = False
        self.controller.error = ""
        self.controller.status = ""

    @staticmethod
    def _shortcut_history_module(*, mutation_locked: bool) -> ModuleType:
        module = ModuleType(f"{PACKAGE_NAME}.infrastructure.shortcut_history")
        module.shortcut_history_mutation_locked = lambda: mutation_locked
        return module

    def test_receipts_are_a_canonical_delivery_bound_chain(self) -> None:
        delivery = _delivery()
        receipts = self.controller._menu_control_receipts(
            delivery, _summaries(), delivery["dispatchedAt"]
        )
        self.assertEqual([item["order"] for item in receipts], list(range(1, 8)))
        self.assertEqual(receipts[0]["previousReceiptContentSha256"], None)
        self.assertEqual(
            [item["previousReceiptContentSha256"] for item in receipts[1:]],
            [item["contentSha256"] for item in receipts[:-1]],
        )
        self.assertEqual(receipts[3]["summary"]["radius"], 1.0)
        for receipt in receipts:
            content = {key: value for key, value in receipt.items() if key != "contentSha256"}
            self.assertEqual(
                receipt["contentSha256"],
                self.controller._shortcut_canonical_sha256(content),
            )

    def test_each_receipt_prefix_becomes_ordered_progress(self) -> None:
        delivery = _delivery()
        receipts = self.controller._menu_control_receipts(
            delivery, _summaries(), delivery["dispatchedAt"]
        )
        self.controller._submit_menu_control_progress(
            delivery, receipts, delivery["dispatchedAt"]
        )
        progress = self.controller._transport.progress
        self.assertEqual(len(progress), 7)
        self.assertEqual(
            [item["nativeHistoryCursor"] for item in progress],
            [0, 0, 0, 1, 4, 7, 8],
        )
        self.assertEqual(progress[-1]["operationReceipts"], receipts)

    def test_terminal_result_never_claims_managed_execution(self) -> None:
        result = self.controller._menu_control_result(
            _delivery(), status="failed_no_mutation",
            terminal={"kind": "failed_no_mutation"}, error="rejected",
            occurred_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        )
        self.assertEqual(result["managedActionResult"], "not_executed")
        self.assertIs(result["managedIdentityVerified"], False)
        self.assertIs(result["managedReceiptCreated"], False)
        self.assertIs(result["requiresUndoToUnlock"], False)

    def test_native_input_gate_blocks_active_menu_driver(self) -> None:
        self.controller._menu_control_proof_driver = object()
        module = self._shortcut_history_module(mutation_locked=False)
        with patch.dict(
            sys.modules,
            {f"{PACKAGE_NAME}.infrastructure.shortcut_history": module},
        ):
            self.assertIs(self.controller.shortcut_mutation_blocked, True)

    def test_native_input_gate_blocks_menu_history_lock(self) -> None:
        self.controller._menu_control_history = _MenuHistory(mutation_locked=True)
        module = self._shortcut_history_module(mutation_locked=False)
        with patch.dict(
            sys.modules,
            {f"{PACKAGE_NAME}.infrastructure.shortcut_history": module},
        ):
            self.assertIs(self.controller.shortcut_mutation_blocked, True)

    def test_native_input_gate_blocks_indeterminate_menu_recovery(self) -> None:
        self.controller._menu_control_recovery_locked = True
        module = self._shortcut_history_module(mutation_locked=False)
        with patch.dict(
            sys.modules,
            {f"{PACKAGE_NAME}.infrastructure.shortcut_history": module},
        ):
            self.assertIs(self.controller.shortcut_mutation_blocked, True)

    def test_menu_authority_rejects_shortcut_history_lock_first(self) -> None:
        module = self._shortcut_history_module(mutation_locked=True)
        with patch.dict(
            sys.modules,
            {f"{PACKAGE_NAME}.infrastructure.shortcut_history": module},
        ):
            with self.assertRaisesRegex(
                ValueError,
                "shortcut proof mutation remains locked",
            ):
                self.controller._validate_menu_control_proof_authority(
                    {}, require_idle_driver=False
                )

    def test_menu_authority_rejects_indeterminate_menu_recovery(self) -> None:
        self.controller._menu_control_recovery_locked = True
        module = self._shortcut_history_module(mutation_locked=False)
        with patch.dict(
            sys.modules,
            {f"{PACKAGE_NAME}.infrastructure.shortcut_history": module},
        ):
            with self.assertRaisesRegex(
                ValueError,
                "menu-control recovery lock requires explicit document recovery",
            ):
                self.controller._validate_menu_control_proof_authority(
                    {}, require_idle_driver=False
                )

    def test_menu_authority_rejects_a_rotated_delivery_lease(self) -> None:
        instance_id = str(uuid.uuid4())
        current_lease_id = str(uuid.uuid4())
        session_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        self.controller.instance_id = instance_id
        self.controller._transport.running = True
        self.controller._transport.session_snapshot = SimpleNamespace(
            lease_id=current_lease_id,
            session_id=session_id,
            document_incarnation_id=document_id,
        )
        delivery = {
            "target": {"adapterId": "blender", "instanceId": instance_id},
            "lease": {
                "leaseId": str(uuid.uuid4()),
                "sessionId": session_id,
                "target": {"adapterId": "blender", "instanceId": instance_id},
                "documentIncarnationId": document_id,
            },
        }
        module = self._shortcut_history_module(mutation_locked=False)
        with patch.dict(
            sys.modules,
            {f"{PACKAGE_NAME}.infrastructure.shortcut_history": module},
        ):
            with self.assertRaisesRegex(
                ValueError,
                "not the current live document lease",
            ):
                self.controller._validate_menu_control_proof_authority(
                    delivery, require_idle_driver=False
                )

    def test_menu_proof_temporarily_restores_the_stock_menu_draw(self) -> None:
        calls: list[str] = []
        presentation = ModuleType(f"{PACKAGE_NAME}.presentation")
        presentation.__path__ = []
        guidance = ModuleType(
            f"{PACKAGE_NAME}.presentation.native_menu_guidance"
        )
        guidance.native_menu_guidance_enabled = lambda: True
        guidance.disable_native_menu_guidance = lambda: calls.append("disable")
        guidance.enable_native_menu_guidance = (
            lambda provider: calls.append(
                "enable" if provider is package.get_session else "wrong-provider"
            )
            or True
        )
        with patch.dict(
            sys.modules,
            {
                presentation.__name__: presentation,
                guidance.__name__: guidance,
            },
        ):
            self.controller._suspend_menu_control_native_guidance()
            self.assertTrue(
                self.controller._menu_control_native_guidance_suspended
            )
            self.assertIsNone(
                self.controller._restore_menu_control_native_guidance()
            )

        self.assertEqual(calls, ["disable", "enable"])
        self.assertFalse(self.controller._menu_control_native_guidance_suspended)

    def test_probe_failures_preserve_completed_stages_and_current_cursor(self) -> None:
        stages = [
            "uv_sphere_created",
            "location_x_set",
            "location_y_set",
            "location_z_set",
            "scale_x_set",
            "scale_y_set",
            "scale_z_set",
            "object_name_set",
        ]
        cases = [
            (f"undo-{index}", 8 - index) for index in range(1, 9)
        ] + [(f"redo-{index}", index) for index in range(1, 9)]
        for label, cursor in cases:
            with self.subTest(label=label):
                transport = _Transport()
                self.controller._transport = transport
                self.controller._menu_control_proof_driver = object()
                self.controller._menu_control_recovery_locked = False
                delivery = _delivery()
                failure_status = (
                    "failed_restored" if label == "undo-8" else "recovery_required"
                )
                self.controller._handle_menu_control_proof_failure(
                    delivery,
                    {
                        "failureStatus": failure_status,
                        "error": f"injected {label} failure",
                        "operationSummaries": _summaries(),
                        "completedMutationStages": stages,
                        "nativeHistoryCursor": cursor,
                        "baselineSceneFingerprintSha256": "b" * 64,
                        "currentSceneFingerprintSha256": (
                            "b" * 64 if failure_status == "failed_restored" else "c" * 64
                        ),
                    },
                )
                self.assertEqual(len(transport.progress), 7)
                self.assertEqual(len(transport.results), 1)
                terminal = transport.results[0]["terminalEvidence"]
                self.assertEqual(terminal["receiptPrefix"][-1]["order"], 7)
                self.assertEqual(terminal["completedMutationStages"], stages)
                self.assertEqual(terminal["internalHistoryCursor"], cursor)
                self.assertEqual(terminal["kind"], failure_status)
                self.assertIs(
                    self.controller._menu_control_recovery_locked,
                    failure_status == "recovery_required",
                )

    def test_terminal_outbox_resubmits_once_per_replacement_lease(self) -> None:
        pending = {"requestId": str(uuid.uuid4()), "status": "succeeded"}
        self.controller._menu_control_history = _MenuHistory(pending=pending)

        self.controller._resubmit_menu_control_terminal_outbox("lease-a")
        self.controller._resubmit_menu_control_terminal_outbox("lease-a")
        self.controller._resubmit_menu_control_terminal_outbox("lease-b")

        self.assertEqual(self.controller._transport.results, [pending, pending])

    def test_terminal_reconciliation_reads_history_without_starting_driver(self) -> None:
        delivery = {"kind": "native_terminal_reconcile", "recoveryId": str(uuid.uuid4())}
        ack = {
            "kind": "native_terminal_reconcile",
            "recoveryId": delivery["recoveryId"],
        }
        menu_history = _MenuHistory(reconciliation_ack=ack)
        self.controller._menu_control_history = menu_history
        scene = object()
        companion.bpy.context.scene = scene

        self.controller._handle_menu_control_terminal_reconcile_request(delivery)

        self.assertIsNone(self.controller._menu_control_proof_driver)
        self.assertEqual(menu_history.reconciliation_calls, [(scene, delivery)])
        self.assertEqual(self.controller._transport.recovery_acks, [ack])
        self.assertEqual(
            self.controller.status,
            "Menu-control terminal reconciliation submitted",
        )

    def test_terminal_reconciliation_waits_for_the_active_driver(self) -> None:
        delivery = {
            "kind": "native_terminal_reconcile",
            "recoveryId": str(uuid.uuid4()),
        }
        ack = {
            "kind": "native_terminal_reconcile",
            "recoveryId": delivery["recoveryId"],
        }
        menu_history = _MenuHistory(reconciliation_ack=ack)
        self.controller._menu_control_history = menu_history
        driver = object()
        self.controller._menu_control_proof_driver = driver
        scene = object()
        companion.bpy.context.scene = scene

        self.controller._handle_menu_control_terminal_reconcile_request(delivery)

        self.assertIs(self.controller._menu_control_proof_driver, driver)
        self.assertEqual(self.controller._transport.recovery_acks, [])
        self.assertEqual(
            self.controller._pending_menu_control_terminal_reconciliation,
            delivery,
        )
        self.assertEqual(menu_history.reconciliation_calls, [])

        self.controller._menu_control_proof_driver = None
        self.controller._drain_pending_menu_control_terminal_reconciliation()

        self.assertEqual(menu_history.reconciliation_calls, [(scene, delivery)])
        self.assertEqual(self.controller._transport.recovery_acks, [ack])
        self.assertIsNone(
            self.controller._pending_menu_control_terminal_reconciliation
        )


if __name__ == "__main__":
    unittest.main()
