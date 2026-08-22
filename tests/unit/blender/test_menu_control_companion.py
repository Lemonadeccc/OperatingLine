"""Focused pure-Python tests for Companion menu-control evidence shaping."""

from __future__ import annotations

from datetime import datetime, timezone
from importlib import import_module
from pathlib import Path
import sys
from queue import Queue
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import PropertyMock, patch
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
        self.transitions = []
        self.recovery_acks = []
        self.action_results = []
        self.accepted_plans = []
        self.last_delivered_sequence = 100
        self.current_document_lease = {
            "leaseId": str(uuid.uuid4()),
            "sessionId": str(uuid.uuid4()),
            "target": {"adapterId": "blender", "instanceId": str(uuid.uuid4())},
            "documentIncarnationId": str(uuid.uuid4()),
            "expiresAt": "2099-01-01T00:00:00Z",
        }
        self.incoming = Queue()

    def submit_menu_control_proof_progress(self, payload):
        self.progress.append(payload)

    def submit_menu_control_proof_result(self, payload):
        self.results.append(payload)

    def submit_menu_control_history_transition(self, payload):
        self.transitions.append(payload)

    def submit_menu_control_proof_recovery_ack(self, payload):
        self.recovery_acks.append(payload)

    def submit_action_result(self, payload):
        self.action_results.append(payload)

    def accept_plan(self, plan_id, revision, plan_content_sha256):
        self.accepted_plans.append((plan_id, revision, plan_content_sha256))


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
        self.transition_acks = []
        self.terminal_acks = []
        self.transitions = []
        self.commitments = None
        self.supersede_calls = []
        self.supersede_result = False
        self.supersede_error = None

    def pending_terminal_result(self):
        return self.pending

    def build_terminal_reconciliation_ack(self, scene, delivery):
        self.reconciliation_calls.append((scene, delivery))
        if self.reconciliation_ack is None:
            raise RuntimeError("no persisted terminal outbox")
        return self.reconciliation_ack

    def register(self, callback=None):
        self.callback = callback

    def pending_transition_results(self):
        return list(self.transitions)

    def acknowledge_transition_results(self, hashes):
        self.transition_acks.append(list(hashes))
        if hashes:
            self.transitions = self.transitions[len(hashes):]

    def acknowledge_terminal_result(self, content_sha256):
        self.terminal_acks.append(content_sha256)
        return True

    def current_marker_commitments(self, _scene):
        if self.commitments is None:
            raise RuntimeError("no commitments")
        return self.commitments

    def reconcile_transition_outbox(self, _scene, delivery):
        hashes = [
            companion.CompanionController._shortcut_canonical_sha256(item)
            for item in self.transitions
        ]
        return {
            "kind": "native_history_transition_reconcile",
            "recoveryId": delivery["recoveryId"],
            "history": {
                "checkpointId": self.commitments["checkpointId"],
                "undoLockId": self.commitments["undoLockId"],
                "checkpointKind": self.commitments["checkpointKind"],
                "stageFingerprints": self.commitments["stageFingerprints"],
                "terminalResultContentSha256": self.commitments["terminalResultContentSha256"],
                "terminalMarkerContentSha256": self.commitments["terminalMarkerContentSha256"],
            },
            "serverAcceptedCursor": delivery["serverAcceptedCursor"],
            "serverAcceptedStatus": delivery["serverAcceptedStatus"],
            "transitions": list(self.transitions),
            "transitionContentSha256s": hashes,
            "terminalResultContentSha256": self.commitments["terminalResultContentSha256"],
            "expectedMarkerContentSha256": self.commitments["terminalMarkerContentSha256"],
            "currentCursor": self.transitions[-1]["toCursor"] if self.transitions else delivery["serverAcceptedCursor"],
            "currentStatus": self.transitions[-1]["status"] if self.transitions else delivery["serverAcceptedStatus"],
            "currentSceneFingerprintSha256": self.commitments["currentSceneFingerprintSha256"],
            "occurredAt": "2026-08-22T10:00:10Z",
        }

    def supersede_restored(self, scene, *, invalidate_redo):
        self.supersede_calls.append(scene)
        if self.supersede_error is not None:
            raise self.supersede_error
        self.invalidate_redo = invalidate_redo
        return self.supersede_result


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
        self.controller._seen_shortcut_proof_request_ids = set()
        self.controller._menu_control_proof_driver = None
        self.controller._seen_menu_control_proof_request_ids = set()
        self.controller._menu_control_history = _MenuHistory()
        self.controller._menu_control_terminal_resubmitted_lease_id = None
        self.controller._menu_control_transition_resubmitted_lease_id = None
        self.controller._pending_menu_control_terminal_reconciliation = None
        self.controller._menu_control_native_guidance_suspended = False
        self.controller._menu_control_recovery_locked = False
        self.controller._stopping_transports = []
        self.controller.pending_plan = None
        self.controller._timer_registered = False
        self.controller.error = ""
        self.controller.status = ""

    @staticmethod
    def _history_fixture():
        checkpoint_id = str(uuid.uuid4())
        undo_lock_id = str(uuid.uuid4())
        fingerprints = [f"{index:064x}" for index in range(1, 10)]
        commitments = {
            "checkpointId": checkpoint_id,
            "undoLockId": undo_lock_id,
            "checkpointKind": "success",
            "stageFingerprints": fingerprints,
            "terminalResultContentSha256": "a" * 64,
            "terminalMarkerContentSha256": "b" * 64,
            "markerContentSha256": "c" * 64,
            "currentSceneFingerprintSha256": fingerprints[7],
        }
        transition = {
            "transitionId": str(uuid.uuid4()),
            "checkpointId": checkpoint_id,
            "undoLockId": undo_lock_id,
            "direction": "undo",
            "fromCursor": 8,
            "toCursor": 7,
            "stage": "scale_z",
            "status": "history_locked",
            "sceneFingerprintSha256": fingerprints[7],
            "occurredAt": "2026-08-22T10:00:03Z",
        }
        return commitments, transition

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

    def test_exact_duplicate_plan_preserves_acceptance_and_diagnostics(self) -> None:
        current = SimpleNamespace(
            plan_id="plan-race",
            revision=1,
            plan_content_sha256="a" * 64,
        )
        accepted_proposal_id = str(uuid.uuid4())
        accepted_decision = {"decisionId": str(uuid.uuid4())}
        self.controller._last_accepted_proposal_id = accepted_proposal_id
        self.controller._last_accepted_proposal_decision = accepted_decision
        self.controller.status = "Menu-control proof queued"
        self.controller.error = "Retain the active proof diagnostic"

        with patch.object(
            self.controller,
            "_validated_session",
            return_value=current,
        ), patch.object(
            package,
            "get_session",
            return_value=current,
        ), patch.object(
            package,
            "replace_session",
            create=True,
        ):
            installed = self.controller.install_plan(
                {"id": current.plan_id, "revision": current.revision},
                plan_content_sha256=current.plan_content_sha256,
            )

        self.assertTrue(installed)
        self.assertEqual(
            self.controller._last_accepted_proposal_id,
            accepted_proposal_id,
        )
        self.assertIs(
            self.controller._last_accepted_proposal_decision,
            accepted_decision,
        )
        self.assertEqual(self.controller.status, "Menu-control proof queued")
        self.assertEqual(
            self.controller.error,
            "Retain the active proof diagnostic",
        )
        self.assertEqual(
            self.controller._transport.accepted_plans,
            [(current.plan_id, current.revision, current.plan_content_sha256)],
        )

    def test_duplicate_plan_before_menu_delivery_keeps_local_authority(self) -> None:
        current = SimpleNamespace(
            plan_id="plan-race",
            revision=1,
            plan_content_sha256="a" * 64,
            receipts=[],
        )
        accepted_proposal_id = str(uuid.uuid4())
        accepted_decision = {"decisionId": str(uuid.uuid4())}
        delivery = {"proposalId": accepted_proposal_id}
        self.controller._last_accepted_proposal_id = accepted_proposal_id
        self.controller._last_accepted_proposal_decision = accepted_decision
        self.controller._transport.incoming.put(
            {
                "kind": "plan",
                "plan": {"id": current.plan_id, "revision": current.revision},
                "planContentSha256": current.plan_content_sha256,
            }
        )
        self.controller._transport.incoming.put(
            {
                "kind": "menu_control_proof_execute_request",
                "request": delivery,
            }
        )
        handled = []

        def handle_menu_control_proof(request):
            self.assertEqual(
                self.controller._last_accepted_proposal_id,
                accepted_proposal_id,
            )
            self.assertIs(
                self.controller._last_accepted_proposal_decision,
                accepted_decision,
            )
            handled.append(request)

        with patch.object(
            self.controller,
            "_validated_session",
            return_value=current,
        ), patch.object(
            self.controller,
            "_reap_stopping_transports",
        ), patch.object(
            self.controller,
            "_handle_menu_control_proof_request",
            side_effect=handle_menu_control_proof,
        ), patch.object(
            package,
            "get_session",
            return_value=current,
        ), patch.object(
            package,
            "replace_session",
            create=True,
        ):
            self.assertIsNone(self.controller.pump())

        self.assertEqual(handled, [delivery])

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

    def test_native_history_callback_builds_a_delivery_bound_report(self) -> None:
        delivery = _delivery()
        commitments, transition = self._history_fixture()
        history = _MenuHistory()
        history.commitments = commitments
        self.controller._menu_control_history = history
        self.controller._menu_control_proof_delivery = delivery
        companion.bpy.context.scene = object()

        self.controller._submit_menu_control_history_transition(transition)

        report = self.controller._transport.transitions[0]
        self.assertEqual(report["requestId"], delivery["requestId"])
        self.assertEqual(report["currentLease"], self.controller._transport.current_document_lease)
        self.assertEqual(report["serverAcceptedCursor"], 8)
        self.assertEqual(report["serverAcceptedStatus"], "history_locked")
        self.assertEqual(
            report["transitionContentSha256"],
            self.controller._shortcut_canonical_sha256(transition),
        )
        self.assertNotIn("currentMarkerContentSha256", report)

    def test_history_reconciliation_clears_only_server_suffix_local_prefix(self) -> None:
        delivery = _delivery()
        commitments, first = self._history_fixture()
        second = {
            **first,
            "transitionId": str(uuid.uuid4()),
            "fromCursor": 7,
            "toCursor": 6,
            "stage": "scale_y",
            "sceneFingerprintSha256": commitments["stageFingerprints"][6],
            "occurredAt": "2026-08-22T10:00:04Z",
        }
        history = _MenuHistory()
        history.commitments = commitments
        history.transitions = [first, second]
        self.controller._menu_control_history = history
        companion.bpy.context.scene = object()
        first_hash = self.controller._shortcut_canonical_sha256(first)
        delivery.update(
            {
                "kind": "native_history_transition_reconcile",
                "recoveryId": str(uuid.uuid4()),
                "replacementLease": self.controller._transport.current_document_lease,
                "history": {},
                "serverAcceptedCursor": 7,
                "serverAcceptedStatus": "history_locked",
                "acknowledgedTransitionContentSha256s": ["d" * 64, first_hash],
                "expectedMarkerContentSha256": "b" * 64,
                "recoveryRequestedAt": "2026-08-22T10:00:05Z",
            }
        )

        self.controller._handle_menu_control_history_reconcile_request(delivery)

        self.assertEqual(history.transition_acks, [[first_hash]])
        ack = self.controller._transport.recovery_acks[0]
        self.assertEqual(ack["requestId"], delivery["requestId"])
        self.assertEqual(ack["transitions"], [second])
        self.assertEqual(
            ack["transitionContentSha256s"],
            [self.controller._shortcut_canonical_sha256(second)],
        )

    def test_empty_history_reconciliation_batch_is_preserved(self) -> None:
        delivery = _delivery()
        commitments, _transition = self._history_fixture()
        history = _MenuHistory()
        history.commitments = commitments
        self.controller._menu_control_history = history
        companion.bpy.context.scene = object()
        delivery.update(
            {
                "kind": "native_history_transition_reconcile",
                "recoveryId": str(uuid.uuid4()),
                "replacementLease": self.controller._transport.current_document_lease,
                "history": {},
                "serverAcceptedCursor": 8,
                "serverAcceptedStatus": "history_locked",
                "acknowledgedTransitionContentSha256s": [],
                "expectedMarkerContentSha256": "b" * 64,
                "recoveryRequestedAt": "2026-08-22T10:00:05Z",
            }
        )

        self.controller._handle_menu_control_history_reconcile_request(delivery)

        ack = self.controller._transport.recovery_acks[0]
        self.assertEqual(ack["transitions"], [])
        self.assertEqual(ack["transitionContentSha256s"], [])

    def test_relock_conflict_with_competing_mutation_fails_closed(self) -> None:
        delivery = _delivery()
        commitments, transition = self._history_fixture()
        transition.update(
            {
                "direction": "redo",
                "fromCursor": 7,
                "toCursor": 8,
                "stage": "renamed_final",
                "sceneFingerprintSha256": commitments["stageFingerprints"][8],
            }
        )
        history = _MenuHistory()
        history.transitions = [transition]
        history.commitments = {
            **commitments,
            "cursor": 8,
            "currentSceneFingerprintSha256": "f" * 64,
        }
        self.controller._menu_control_history = history
        self.controller._menu_control_proof_delivery = delivery
        companion.bpy.context.scene = object()
        digest = self.controller._shortcut_canonical_sha256(transition)

        self.controller._handle_menu_control_history_relock_conflict(
            {
                "kind": "menu_control_history_relock_conflict",
                "requestId": delivery["requestId"],
                "transitionContentSha256": digest,
                "transition": transition,
                "runtimeCode": "menu_control_proof_history_relock_conflict",
                "runtimePayload": {"competingExecutionId": str(uuid.uuid4())},
                "message": "another execution acquired the restored target",
            }
        )

        self.assertIs(self.controller._menu_control_recovery_locked, True)
        self.assertEqual(self.controller.status, "Menu-control proof recovery required")
        self.assertIn("live Scene diverged", self.controller.error)
        self.assertEqual(history.transitions, [transition])
        self.assertEqual(history.transition_acks, [])
        self.controller._resubmit_menu_control_transition_outbox(str(uuid.uuid4()))
        self.assertEqual(self.controller._transport.transitions, [])

    def test_permanent_transition_rejection_enters_recovery_without_ack(self) -> None:
        self.controller._transport.incoming.put(
            {
                "kind": "menu_control_history_transition_rejected",
                "requestId": str(uuid.uuid4()),
                "transitionContentSha256": "a" * 64,
                "runtimeCode": "menu_control_proof_history_transition_identity_mismatch",
                "runtimePayload": {"message": "checkpoint differs"},
                "message": "checkpoint differs",
            }
        )

        self.controller.pump()

        self.assertIs(self.controller._menu_control_recovery_locked, True)
        self.assertEqual(self.controller.status, "Menu-control proof recovery required")
        self.assertEqual(self.controller.error, "checkpoint differs")

    def test_permanent_recovery_rejection_locks_without_acknowledging_outbox(
        self,
    ) -> None:
        commitments, transition = self._history_fixture()
        history = _MenuHistory()
        history.commitments = commitments
        history.transitions = [transition]
        self.controller._menu_control_history = history
        self.controller._transport.incoming.put(
            {
                "kind": "menu_control_proof_recovery_rejected",
                "requestId": str(uuid.uuid4()),
                "recoveryId": str(uuid.uuid4()),
                "runtimeCode": "menu_control_proof_history_relock_conflict",
                "runtimePayload": {"message": "target was relocked"},
                "message": "target was relocked",
            }
        )

        self.controller.pump()

        self.assertIs(self.controller._menu_control_recovery_locked, True)
        self.assertEqual(self.controller.status, "Menu-control proof recovery required")
        self.assertEqual(history.transitions, [transition])
        self.assertEqual(history.transition_acks, [])
        self.assertEqual(history.terminal_acks, [])

    def test_session_established_never_resubmits_transition_before_absence_event(
        self,
    ) -> None:
        commitments, transition = self._history_fixture()
        history = _MenuHistory()
        history.commitments = commitments
        history.transitions = [transition]
        self.controller._menu_control_history = history
        self.controller._menu_control_proof_delivery = _delivery()
        self.controller.proposal_session = None
        lease_id = str(uuid.uuid4())
        self.controller._transport.incoming.put(
            {
                "kind": "session_established",
                "leaseId": lease_id,
            }
        )
        session = SimpleNamespace(plan_id=None, revision=None)

        with patch.object(
            package, "get_session", return_value=session
        ), patch.object(self.controller, "report"):
            self.controller.pump()
            self.assertEqual(self.controller._transport.transitions, [])
            self.controller._transport.incoming.put(
                {
                    "kind": "menu_control_proof_recovery_absent",
                    "leaseId": lease_id,
                }
            )
            self.controller.pump()

        self.assertEqual(len(self.controller._transport.transitions), 1)
        self.assertEqual(
            self.controller._transport.transitions[0]["transition"], transition
        )

    def test_t1_ack_loss_fresh_transport_recovers_t1_before_submitting_t2(self) -> None:
        delivery = _delivery()
        commitments, t1 = self._history_fixture()
        t2 = {
            **t1,
            "transitionId": str(uuid.uuid4()),
            "fromCursor": 7,
            "toCursor": 6,
            "stage": "scale_y",
            "sceneFingerprintSha256": commitments["stageFingerprints"][6],
            "occurredAt": "2026-08-22T10:00:04Z",
        }
        t1_sha256 = self.controller._shortcut_canonical_sha256(t1)
        t2_sha256 = self.controller._shortcut_canonical_sha256(t2)
        history = _MenuHistory()
        history.commitments = commitments
        history.transitions = [t1, t2]
        self.controller._menu_control_history = history
        self.controller._transport = _Transport()
        self.controller.proposal_session = None
        companion.bpy.context.scene = object()
        lease_id = self.controller._transport.current_document_lease["leaseId"]
        self.controller._transport.incoming.put(
            {"kind": "session_established", "leaseId": lease_id}
        )
        session = SimpleNamespace(plan_id=None, revision=None)

        with patch.object(
            package, "get_session", return_value=session
        ), patch.object(self.controller, "report"):
            self.controller.pump()
            self.assertEqual(self.controller._transport.transitions, [])
            challenge = {
                **delivery,
                "kind": "native_history_transition_reconcile",
                "recoveryId": str(uuid.uuid4()),
                "replacementLease": self.controller._transport.current_document_lease,
                "history": {},
                "serverAcceptedCursor": 7,
                "serverAcceptedStatus": "history_locked",
                "acknowledgedTransitionContentSha256s": [t1_sha256],
                "expectedMarkerContentSha256": commitments[
                    "terminalMarkerContentSha256"
                ],
                "recoveryRequestedAt": "2026-08-22T10:00:05Z",
            }
            self.controller._transport.incoming.put(
                {
                    "kind": "menu_control_proof_history_reconcile_request",
                    "request": challenge,
                }
            )
            self.controller.pump()

        self.assertEqual(self.controller._transport.transitions, [])
        self.assertEqual(history.transition_acks, [[t1_sha256]])
        self.assertEqual(history.transitions, [t2])
        self.assertEqual(
            self.controller._transport.recovery_acks[0][
                "transitionContentSha256s"
            ],
            [t2_sha256],
        )

    def test_redo_invalidator_uses_view3d_undo_push_barrier(self) -> None:
        calls = []
        region = SimpleNamespace(type="WINDOW")
        space = object()
        area = SimpleNamespace(
            type="VIEW_3D",
            regions=[region],
            spaces=SimpleNamespace(active=space),
        )
        window = SimpleNamespace(screen=SimpleNamespace(areas=[area]))

        class Override:
            def __enter__(self):
                calls.append("override_enter")

            def __exit__(self, *_args):
                calls.append("override_exit")

        companion.bpy.context.window = window
        companion.bpy.context.temp_override = lambda **kwargs: (
            calls.append(kwargs) or Override()
        )
        companion.bpy.ops = SimpleNamespace(
            ed=SimpleNamespace(
                undo_push=lambda **kwargs: calls.append(kwargs) or {"FINISHED"}
            )
        )

        self.assertIs(self.controller._invalidate_menu_control_redo(), True)
        self.assertEqual(calls[0]["area"], area)
        self.assertEqual(calls[0]["region"], region)
        self.assertEqual(calls[0]["space_data"], space)
        self.assertEqual(calls[1:], ["override_enter", {"message": "OperatingLine supersede restored menu proof"}, "override_exit"])

    def test_menu_and_shortcut_start_only_after_restored_history_supersedes(self) -> None:
        for kind in ("menu", "shortcut"):
            with self.subTest(kind=kind):
                order = []
                history = _MenuHistory()
                history.supersede_restored = lambda _scene, **_kwargs: order.append("supersede") or True
                self.controller._menu_control_history = history
                scene = object()
                companion.bpy.context.scene = scene

                class Driver:
                    def __init__(self, *_args, **_kwargs):
                        order.append("construct")

                    def start(self, **_kwargs):
                        order.append("start")
                        _kwargs["preflight_hook"]()
                        order.extend(["ui_preflight", "steps", "timer"])
                        _kwargs["pre_mutation_hook"]()

                if kind == "menu":
                    module_name = f"{PACKAGE_NAME}.infrastructure.menu_control_proof"
                    module = ModuleType(module_name)
                    module.UVSphereMenuControlProof = Driver
                    delivery = {"requestId": str(uuid.uuid4())}
                    with patch.dict(sys.modules, {module_name: module}), patch.object(
                        self.controller,
                        "_validate_menu_control_proof_authority",
                        side_effect=lambda *_args, **_kwargs: order.append("validate"),
                    ), patch.object(
                        self.controller, "_suspend_menu_control_native_guidance"
                    ):
                        self.controller._handle_menu_control_proof_request(delivery)
                else:
                    module_name = f"{PACKAGE_NAME}.infrastructure.shortcut_proof"
                    module = ModuleType(module_name)
                    module.SubdivisionSurfaceF9ShortcutProof = Driver
                    delivery = {
                        "requestId": str(uuid.uuid4()),
                        "proofId": str(uuid.uuid4()),
                        "deliveryId": str(uuid.uuid4()),
                        "bindingContentSha256": "a" * 64,
                        "binding": {
                            "acceptedAction": {"arguments": {"viewportLevel": 2}}
                        },
                    }
                    with patch.dict(sys.modules, {module_name: module}), patch.object(
                        self.controller,
                        "_validate_shortcut_proof_authority",
                        side_effect=lambda *_args, **_kwargs: order.append("validate"),
                    ):
                        self.controller._handle_shortcut_proof_execute_request(delivery)

                self.assertEqual(
                    order,
                    [
                        "validate", "construct", "start", "validate",
                        "ui_preflight", "steps", "timer", "supersede",
                    ],
                )

    def test_menu_supersession_preserves_new_delivery_for_continuation(self) -> None:
        delivery = {"requestId": str(uuid.uuid4())}
        history = _MenuHistory()
        history.supersede_restored = lambda _scene, **_kwargs: True
        self.controller._menu_control_history = history
        companion.bpy.context.scene = object()
        continuation_deliveries = []

        class Driver:
            def start(self, **kwargs):
                kwargs["preflight_hook"]()
                kwargs["pre_mutation_hook"]()
                kwargs["continuation_guard"]()

        module_name = f"{PACKAGE_NAME}.infrastructure.menu_control_proof"
        module = ModuleType(module_name)
        module.UVSphereMenuControlProof = Driver

        def validate_continuation(candidate, driver):
            self.assertIs(self.controller._menu_control_proof_driver, driver)
            self.assertEqual(self.controller._menu_control_proof_delivery, delivery)
            continuation_deliveries.append(candidate)

        with patch.dict(sys.modules, {module_name: module}), patch.object(
            self.controller, "_validate_menu_control_proof_authority"
        ), patch.object(
            self.controller,
            "_validate_menu_control_proof_continuation_authority",
            side_effect=validate_continuation,
        ), patch.object(
            self.controller, "_suspend_menu_control_native_guidance"
        ):
            self.controller._handle_menu_control_proof_request(delivery)

        self.assertEqual(continuation_deliveries, [delivery])
        self.assertEqual(self.controller._menu_control_proof_delivery, delivery)

    def test_synchronous_start_failure_is_not_overwritten_as_executing(self) -> None:
        for kind in ("menu", "shortcut"):
            for failure_point in ("timer_registration", "pre_mutation_hook"):
                with self.subTest(kind=kind, failure_point=failure_point):
                    evidence = {
                        "failureStatus": "preflight_rejected",
                        "error": f"{failure_point} failed",
                        "mutationStarted": False,
                    }

                    class Driver:
                        def __init__(self, *_args, **_kwargs):
                            pass

                        def start(self, **kwargs):
                            kwargs["on_failure"](evidence)

                    if kind == "menu":
                        module_name = f"{PACKAGE_NAME}.infrastructure.menu_control_proof"
                        module = ModuleType(module_name)
                        module.UVSphereMenuControlProof = Driver
                        delivery = {"requestId": str(uuid.uuid4())}
                        failure_handler_name = "_handle_menu_control_proof_failure"
                        request_handler = self.controller._handle_menu_control_proof_request
                        authority_name = "_validate_menu_control_proof_authority"
                    else:
                        module_name = f"{PACKAGE_NAME}.infrastructure.shortcut_proof"
                        module = ModuleType(module_name)
                        module.SubdivisionSurfaceF9ShortcutProof = Driver
                        delivery = {
                            "requestId": str(uuid.uuid4()),
                            "proofId": str(uuid.uuid4()),
                            "deliveryId": str(uuid.uuid4()),
                            "bindingContentSha256": "a" * 64,
                            "binding": {
                                "acceptedAction": {
                                    "arguments": {"viewportLevel": 2}
                                }
                            },
                        }
                        failure_handler_name = "_handle_shortcut_proof_failure"
                        request_handler = self.controller._handle_shortcut_proof_execute_request
                        authority_name = "_validate_shortcut_proof_authority"

                    captured = []

                    def record_failure(_delivery, failure_evidence):
                        captured.append(failure_evidence)
                        if kind == "menu":
                            self.controller._menu_control_proof_driver = None
                        else:
                            self.controller._shortcut_proof_driver = None
                        self.controller.error = failure_evidence["error"]
                        self.controller.status = f"{kind} rejected"

                    with patch.dict(sys.modules, {module_name: module}), patch.object(
                        self.controller, authority_name
                    ), patch.object(
                        self.controller,
                        failure_handler_name,
                        side_effect=record_failure,
                    ), patch.object(
                        self.controller, "_suspend_menu_control_native_guidance"
                    ):
                        request_handler(delivery)

                    self.assertEqual(captured, [evidence])
                    self.assertIs(captured[0]["mutationStarted"], False)
                    self.assertNotIn("executing", self.controller.status.lower())
                    self.assertEqual(self.controller.error, evidence["error"])

    def test_action_mutation_starts_only_after_restored_history_supersedes(self) -> None:
        order = []
        history = _MenuHistory()
        history.supersede_restored = lambda _scene, **_kwargs: order.append("supersede") or True
        self.controller._menu_control_history = history
        self.controller.instance_id = str(uuid.uuid4())
        self.controller._last_accepted_proposal_id = str(uuid.uuid4())
        self.controller.proposed_plan = None
        self.controller._proposal_candidates = {}
        self.controller.pending_plan = None
        self.controller.last_delivered_sequence = 4
        execution_id = str(uuid.uuid4())
        candidate = SimpleNamespace(id="step.create")
        session = SimpleNamespace(
            observation_blocked=False,
            started=True,
            execution_id=execution_id,
            plan_id="plan",
            revision=1,
            plan_content_sha256="a" * 64,
            active_index=-1,
            steps=[candidate],
        )
        delivered_step = {
            "id": candidate.id,
            "action": {
                "adapterId": "blender",
                "name": "blender.mesh.create_uv_sphere",
                "arguments": {},
            },
        }
        first_report = {"reportId": str(uuid.uuid4()), "sequence": 4, "protocolVersion": "1.5.0"}
        self.controller.last_report = first_report
        delivery = {
            "formatVersion": "1.0.0",
            "requestId": str(uuid.uuid4()),
            "target": {"adapterId": "blender", "instanceId": self.controller.instance_id},
            "proposalId": self.controller._last_accepted_proposal_id,
            "plan": {"id": "plan", "revision": 1},
            "planContentSha256": "a" * 64,
            "executionId": execution_id,
            "expectedState": {"reportId": first_report["reportId"], "sequence": 4},
            "step": delivered_step,
        }

        def execute_next():
            order.append("mutate")
            self.controller.last_report = {
                "reportId": str(uuid.uuid4()),
                "sequence": 5,
                "transition": "step_succeeded",
                "stepId": candidate.id,
                "plan": delivery["plan"],
                "planContentSha256": delivery["planContentSha256"],
                "executionId": execution_id,
                "observations": [{"satisfied": True}],
                "nativeUndoCheckpoint": {"operation": "next"},
            }
            return {"FINISHED"}

        companion.bpy.context.scene = object()
        companion.bpy.ops = SimpleNamespace(
            operating_line=SimpleNamespace(next=execute_next)
        )
        shortcut_module = self._shortcut_history_module(mutation_locked=False)
        with patch.object(package, "get_session", return_value=session), patch.dict(
            sys.modules,
            {f"{PACKAGE_NAME}.infrastructure.shortcut_history": shortcut_module},
        ), patch.object(
            companion.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ), patch.object(
            self.controller, "_source_step", return_value=delivered_step
        ), patch.object(
            self.controller,
            "_action_result_payload",
            return_value={"requestId": delivery["requestId"]},
        ):
            self.controller._handle_action_execute_request(delivery)

        self.assertEqual(order, ["supersede", "mutate"])

    def test_supersession_failure_locks_recovery_before_any_new_mutation(self) -> None:
        history = _MenuHistory()
        history.supersede_error = RuntimeError("baseline changed")
        self.controller._menu_control_history = history
        companion.bpy.context.scene = object()

        with self.assertRaisesRegex(RuntimeError, "failed closed"):
            self.controller._supersede_restored_menu_history()

        self.assertIs(self.controller._menu_control_recovery_locked, True)


if __name__ == "__main__":
    unittest.main()
