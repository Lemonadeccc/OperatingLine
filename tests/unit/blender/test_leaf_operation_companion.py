"""Main-thread Companion consumption of guided Geometry micro-operations."""

from copy import deepcopy
from dataclasses import replace
from importlib import import_module
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
import uuid
from unittest.mock import PropertyMock, patch


PACKAGE_ROOT = (
    Path(__file__).resolve().parents[3]
    / "adapters"
    / "blender"
    / "extension"
    / "operating_line"
)
PACKAGE_NAME = "operating_line_leaf_operation_companion_test"
fake_bpy = ModuleType("bpy")
fake_bpy.context = SimpleNamespace(scene={})
fake_bpy.app = SimpleNamespace(version_string="4.5.3", timers=SimpleNamespace())
fake_bpy.ops = SimpleNamespace()
previous_bpy = sys.modules.get("bpy")
sys.modules["bpy"] = fake_bpy
package = ModuleType(PACKAGE_NAME)
package.__path__ = [str(PACKAGE_ROOT)]
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
transport_module = import_module(f"{PACKAGE_NAME}.infrastructure.companion_transport")
command_module = import_module(f"{PACKAGE_NAME}.application.guided_geometry_command")
companion_module = import_module(f"{PACKAGE_NAME}.application.companion")
if previous_bpy is None:
    del sys.modules["bpy"]
else:
    sys.modules["bpy"] = previous_bpy


IDS = transport_module.TRANSFORM_GEOMETRY_LEAF_OPERATION_IDS
ACTION = transport_module.TRANSFORM_GEOMETRY_LEAF_OPERATION_ACTION
RECIPE = transport_module.TRANSFORM_GEOMETRY_LEAF_OPERATION_RECIPE


class _Transport:
    def __init__(self, events):
        self.events = events
        self.last_delivered_sequence = 7

    def _validate_leaf_operation_delivery(self, delivery):
        return deepcopy(delivery)

    def submit_leaf_operation_result(self, result):
        self.events.append(("result", deepcopy(result)))

    def submit_leaf_operation_recovery_ack(self, ack):
        self.events.append(("recovery_ack", deepcopy(ack)))


class _Session:
    def __init__(self, step, source_step, run=None):
        self.started = True
        self.execution_id = str(uuid.uuid4())
        self.plan_id = "plan-1"
        self.revision = 1
        self.plan_content_sha256 = "1" * 64
        self.active_index = -1
        self.steps = (step,)
        self.guidance_step = step
        self.pending_leaf_operation_run = run
        self.leaf_operation_runs = {}
        if run is not None:
            self.leaf_operation_runs[run.step_id] = run
        self.receipts = {}
        self.observation_blocked = False
        self._source = {"steps": [source_step]}

    def source_plan_copy(self):
        return deepcopy(self._source)


class LeafOperationCompanionTests(unittest.TestCase):
    def test_controller_accepts_only_non_negative_initial_report_sequence(self):
        menu_history_module = ModuleType(
            f"{PACKAGE_NAME}.infrastructure.menu_control_history"
        )
        menu_history_module.MenuControlHistoryController = lambda: SimpleNamespace()
        with patch.dict(
            sys.modules,
            {menu_history_module.__name__: menu_history_module},
        ):
            controller = companion_module.CompanionController(
                str(uuid.uuid4()),
                session_id=str(uuid.uuid4()),
                document_incarnation_id=str(uuid.uuid4()),
                initial_report_sequence=7,
            )
        self.assertEqual(controller.report_sequence, 7)
        for invalid in (
            True,
            -1,
            1.5,
            "7",
            companion_module.MAX_COMPANION_REPORT_SEQUENCE + 1,
        ):
            with (
                self.subTest(invalid=invalid),
                self.assertRaises(ValueError),
            ):
                companion_module.CompanionController(
                    str(uuid.uuid4()),
                    session_id=str(uuid.uuid4()),
                    document_incarnation_id=str(uuid.uuid4()),
                    initial_report_sequence=invalid,
                )

    def setUp(self) -> None:
        self.events = []
        self.arguments = {
            "targetId": "object.target",
            "modifierId": "modifier.geometry",
            "modifierName": "Geometry Nodes",
            "nodeGroupId": "node-group.transform",
            "nodeGroupName": "Transform Geometry",
            "translation": [1.0, 2.0, 3.0],
            "rotation": [0.0, 0.0, 0.5],
            "scale": [2.0, 2.0, 2.0],
        }
        self.step = SimpleNamespace(
            id="leaf.transform",
            action=SimpleNamespace(name=ACTION, arguments=deepcopy(self.arguments)),
        )
        self.source_step = {
            "id": self.step.id,
            "action": {
                "adapterId": "blender",
                "name": ACTION,
                "arguments": deepcopy(self.arguments),
            },
        }
        self.session = _Session(self.step, self.source_step)
        package.get_session = lambda: self.session
        self.controller = companion_module.CompanionController.__new__(
            companion_module.CompanionController
        )
        self.controller.instance_id = str(uuid.uuid4())
        self.controller._transport = _Transport(self.events)
        self.controller._seen_leaf_operation_request_ids = set()
        self.controller._pending_leaf_operation_recovery_witness_id = None
        self.controller._active_leaf_operation_recovery_challenge = None
        self.controller._pending_leaf_operation_recovery_ack_id = None
        self.controller._leaf_operation_recovery_retry_signature = None
        self.controller._leaf_operation_recovery_retry_at = 0.0
        self.controller._last_accepted_proposal_id = str(uuid.uuid4())
        self.controller._last_accepted_proposal_decision = {
            "proposalId": self.controller._last_accepted_proposal_id,
            "decision": "accepted",
            "adapterId": "blender",
            "instanceId": self.controller.instance_id,
        }
        self.controller.proposed_plan = None
        self.controller._proposal_candidates = {}
        self.controller.pending_plan = None
        self.controller.last_delivered_sequence = 7
        self.controller.error = ""
        self.controller.status = ""
        self.controller.last_report = {
            "protocolVersion": "1.6.0",
            "reportId": str(uuid.uuid4()),
            "sequence": 7,
        }
        self.snapshot = SimpleNamespace(
            recipe_id=RECIPE,
            catalog_version=companion_module.BUNDLED_INTERACTION_CATALOG.catalog_version,
            cursor_token="cursor-1",
            focused_ordinal=1,
            operations=tuple(
                SimpleNamespace(operation_id=value, ordinal=index)
                for index, value in enumerate(IDS, start=1)
            ),
        )

    def _delivery(self, ordinal):
        raw = json.loads(companion_module.RESOURCE_PATH.read_text(encoding="utf-8"))
        action_name = self.source_step["action"]["name"]
        recipe_id = self.snapshot.recipe_id
        operation_ids = tuple(
            operation.operation_id for operation in self.snapshot.operations
        )
        recipe = next(item for item in raw["recipes"] if item["id"] == recipe_id)
        _, _, parameters = self.controller._leaf_operation_catalog_authority(
            self.source_step, ordinal
        )
        now = "2026-08-24T12:00:00Z"
        return {
            "formatVersion": "1.0.0",
            "requestId": str(uuid.uuid4()),
            "replayId": str(uuid.uuid4()),
            "deliveryId": str(uuid.uuid4()),
            "target": {"adapterId": "blender", "instanceId": self.controller.instance_id},
            "proposalId": self.controller._last_accepted_proposal_id,
            "plan": {"id": self.session.plan_id, "revision": self.session.revision},
            "planContentSha256": self.session.plan_content_sha256,
            "executionId": self.session.execution_id,
            "leafId": self.step.id,
            "stepId": self.step.id,
            "actionName": action_name,
            "recipeId": recipe_id,
            "catalogVersion": self.snapshot.catalog_version,
            "interactionCatalogContentSha256": transport_module.CompanionTransport._canonical_sha256(raw),
            "materializationContentSha256": transport_module.CompanionTransport._canonical_sha256(recipe["procedureMaterialization"]),
            "mcpTrackContentSha256": transport_module.CompanionTransport._canonical_sha256(recipe["procedureMaterialization"]["mcp"]),
            "expectedState": {
                "reportId": self.controller.last_report["reportId"],
                "sequence": 7,
            },
            "operationIds": list(operation_ids),
            "operationOrdinal": ordinal,
            "sourceOperationId": operation_ids[ordinal - 1],
            "operationParameters": parameters,
            "operationBindingSha256": "2" * 64,
            "requestedAt": now,
            "dispatchedAt": now,
        }

    def _modules(self, command_result, *, focus_result=True):
        guided = ModuleType(f"{PACKAGE_NAME}.infrastructure.guided_geometry_operations")
        guided.GuidedGeometryAtomicityError = type("GuidedGeometryAtomicityError", (RuntimeError,), {})
        guided.execute_transform_geometry_operation = lambda **_kwargs: None
        guided.inverse_transform_geometry_operation = lambda **_kwargs: None
        guided.resume_transform_geometry_transaction = lambda **_kwargs: None
        guided.verify_transform_geometry_stage = lambda **_kwargs: True
        light = ModuleType(
            f"{PACKAGE_NAME}.infrastructure.guided_light_trails_operations"
        )
        light.execute_light_trails_operation = lambda **_kwargs: None
        light.inverse_light_trails_operation = lambda **_kwargs: None
        light.resume_light_trails_transaction = lambda **_kwargs: None
        light.verify_light_trails_stage = lambda **_kwargs: True
        history = ModuleType(f"{PACKAGE_NAME}.infrastructure.native_history")
        history.NativeHistoryRecovery = lambda state, probe: (state, probe)
        history.NativeUndoRequiredError = type("NativeUndoRequiredError", (RuntimeError,), {})
        history.cancel_native_history = lambda: None
        history.commit_native_history = lambda *_args, **_kwargs: None
        history.native_history_requires_native_undo = lambda: False
        history.peek_native_undo_recovery_guard = lambda: SimpleNamespace(
            expected_restored_checkpoint_id=None,
            recovery_token_sha256="6" * 64,
        )
        history.peek_native_undo_restoration_witness = lambda: None
        history.consume_native_undo_restoration_witness = lambda: None
        history.native_leaf_checkpoint_attestation = lambda _session: None
        history.prepare_native_history = lambda *_args: None
        history.prepared_native_history_changed = lambda *_args: False
        common = ModuleType(f"{PACKAGE_NAME}.infrastructure.snowman_actions.common")
        common.ActionAtomicityError = type("ActionAtomicityError", (RuntimeError,), {})
        common.action_host_state_restored = lambda _error: True
        editing = ModuleType(f"{PACKAGE_NAME}.infrastructure.snowman_actions.editing")
        editing.validate_geometry_nodes_transform = lambda value: value
        editing.validate_geometry_nodes_light_trails = lambda value: value
        presentation = ModuleType(f"{PACKAGE_NAME}.presentation")
        presentation.__path__ = []
        guidance = ModuleType(f"{PACKAGE_NAME}.presentation.native_menu_guidance")
        guidance.leaf_guidance_snapshot = lambda _step: self.snapshot
        guidance.focus_next_leaf_operation = lambda *_args: focus_result
        modules = {
            guided.__name__: guided,
            light.__name__: light,
            history.__name__: history,
            common.__name__: common,
            editing.__name__: editing,
            presentation.__name__: presentation,
            guidance.__name__: guidance,
            "bpy": fake_bpy,
        }
        return modules, patch.object(
            command_module,
            "execute_guided_geometry_operation",
            return_value=command_result,
        )

    def _result(self, ordinal, *, completed=False, native_undo_required=False):
        operation_ids = tuple(
            operation.operation_id for operation in self.snapshot.operations
        )
        action_name = self.source_step["action"]["name"]
        recipe_id = self.snapshot.recipe_id
        total = len(operation_ids)
        observation = {
            "kind": "guided_geometry_operation",
            "satisfied": True,
            "details": {
                "status": "passed",
                "direction": "forward",
                "operationOrdinal": ordinal,
                "operationId": operation_ids[ordinal - 1],
                "mutating": 2 <= ordinal < total,
                "receiptId": str(uuid.uuid4()),
                "runId": str(uuid.uuid4()),
                "stepId": self.step.id,
                "actionName": action_name,
                "recipeId": recipe_id,
                "catalogVersion": self.snapshot.catalog_version,
                "beforeFingerprintSha256": "3" * 64,
                "afterFingerprintSha256": "4" * 64,
                "evidence": {
                    "completedOperations": list(range(1, ordinal + 1)),
                    "preconditionsValidated": ordinal == 1,
                    "completeGraph": completed,
                },
            },
        }
        return command_module.GuidedGeometryCommandResult(
            run_id=observation["details"]["runId"],
            binding_sha256="5" * 64,
            operation_id=operation_ids[ordinal - 1],
            ordinal=ordinal,
            total=total,
            next_ordinal=ordinal + 1,
            completed_operation_ids=operation_ids[:ordinal],
            observation=observation,
            leaf_completed=completed,
            report_transition=(
                command_module.GuidedGeometryReportTransition("step_succeeded", self.step)
                if completed
                else None
            ),
            native_undo_required=native_undo_required,
        )

    def _configure_light_trails(self) -> tuple[str, ...]:
        operation_ids = tuple(transport_module.LIGHT_TRAILS_LEAF_OPERATION_IDS)
        arguments = {
            "targetId": "object.light-trails",
            "modifierId": "modifier.light-trails",
            "modifierName": "OperatingLine.Light Trails Modifier",
            "nodeGroupId": "node-group.light-trails",
            "nodeGroupName": "OperatingLine.Light Trails",
            "trailCount": 9,
            "pointsPerTrail": 48,
            "tileLength": 12.0,
            "trailSpacing": 0.4,
            "noiseScale": 1.75,
            "noiseDetail": 3.0,
            "noiseRoughness": 0.55,
            "noiseSeed": 8.0,
            "height": 1.2,
            "profileSides": 4,
            "profileRadius": 0.025,
            "tileRepeatCount": 3,
        }
        self.arguments = arguments
        self.step.id = "leaf.light-trails"
        self.step.action = SimpleNamespace(
            name=transport_module.LIGHT_TRAILS_LEAF_OPERATION_ACTION,
            arguments=deepcopy(arguments),
        )
        self.source_step = {
            "id": self.step.id,
            "action": {
                "adapterId": "blender",
                "name": transport_module.LIGHT_TRAILS_LEAF_OPERATION_ACTION,
                "arguments": deepcopy(arguments),
            },
        }
        self.session.steps = (self.step,)
        self.session.guidance_step = self.step
        self.session._source = {"steps": [self.source_step]}
        self.snapshot.recipe_id = transport_module.LIGHT_TRAILS_LEAF_OPERATION_RECIPE
        self.snapshot.focused_ordinal = 1
        self.snapshot.operations = tuple(
            SimpleNamespace(operation_id=value, ordinal=index)
            for index, value in enumerate(operation_ids, start=1)
        )
        return operation_ids

    def test_operation_01_returns_partial_progress_without_state_report(self):
        result = self._result(1)
        modules, command_patch = self._modules(result)
        self.controller.report = lambda *_args, **_kwargs: self.fail("partial operation reported state")
        with patch.dict(sys.modules, modules), command_patch, patch.object(
            companion_module.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ):
            self.controller._handle_leaf_operation_execute_request(self._delivery(1))
        progress = self.events[-1][1]["progress"]
        self.assertEqual(progress["completedOperationIds"], [IDS[0]])
        self.assertIsNone(progress["finalReport"])

    def test_light_trails_catalog_authority_and_first_to_final_dispatch(self):
        operation_ids = self._configure_light_trails()
        expected_parameters = {
            1: {
                "targetId": "object.light-trails",
                "modifierId": "modifier.light-trails",
                "modifierName": "OperatingLine.Light Trails Modifier",
                "nodeGroupId": "node-group.light-trails",
                "nodeGroupName": "OperatingLine.Light Trails",
            },
            5: {"tileLength": 12.0},
            31: {"tileRepeatCount": 3},
            54: {},
        }
        for ordinal, expected in expected_parameters.items():
            _catalog, catalog_ids, parameters = (
                self.controller._leaf_operation_catalog_authority(
                    self.source_step, ordinal
                )
            )
            self.assertEqual(catalog_ids, operation_ids)
            self.assertEqual(parameters, expected)

        first = self._result(1)
        modules, command_patch = self._modules(first)
        self.controller.report = lambda *_args, **_kwargs: self.fail(
            "partial Light Trails operation reported state"
        )
        with patch.dict(sys.modules, modules), command_patch as execute, patch.object(
            companion_module.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ):
            self.controller._handle_leaf_operation_execute_request(self._delivery(1))
        self.assertEqual(
            self.events[-1][1]["progress"]["completedOperationIds"],
            [operation_ids[0]],
        )
        self.assertEqual(
            execute.call_args.kwargs["action_name"],
            transport_module.LIGHT_TRAILS_LEAF_OPERATION_ACTION,
        )
        self.assertEqual(
            execute.call_args.kwargs["recipe_id"],
            transport_module.LIGHT_TRAILS_LEAF_OPERATION_RECIPE,
        )

        self.events.clear()
        run_id = str(uuid.uuid4())
        self.session.pending_leaf_operation_run = SimpleNamespace(
            next_ordinal=len(operation_ids),
            run_id=run_id,
            binding_sha256="5" * 64,
        )
        self.snapshot.focused_ordinal = len(operation_ids)
        final_result = replace(
            self._result(len(operation_ids), completed=True), run_id=run_id
        )
        final_result.observation["details"]["runId"] = run_id
        modules, command_patch = self._modules(final_result)
        final_report = {
            "reportId": str(uuid.uuid4()),
            "sequence": 8,
            "transition": "step_succeeded",
            "stepId": self.step.id,
        }
        self.controller.report = (
            lambda *_args, **_kwargs: self.events.append(("report", final_report))
            or final_report
        )
        with patch.dict(sys.modules, modules), command_patch, patch.object(
            companion_module.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ):
            self.controller._handle_leaf_operation_execute_request(
                self._delivery(len(operation_ids))
            )
        self.assertEqual([kind for kind, _value in self.events], ["report", "result"])
        self.assertTrue(self.events[-1][1]["progress"]["leafCompleted"])
        self.assertEqual(
            self.events[-1][1]["progress"]["completedOperationIds"],
            list(operation_ids),
        )

    def test_operation_02_continues_exact_run(self):
        run_id = str(uuid.uuid4())
        self.session.pending_leaf_operation_run = SimpleNamespace(
            next_ordinal=2, run_id=run_id, binding_sha256="5" * 64
        )
        self.snapshot.focused_ordinal = 2
        result = self._result(2)
        result.observation["details"]["runId"] = run_id
        result = replace(result, run_id=run_id)
        modules, command_patch = self._modules(result)
        with patch.dict(sys.modules, modules), command_patch, patch.object(
            companion_module.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ):
            self.controller._handle_leaf_operation_execute_request(self._delivery(2))
        self.assertEqual(self.events[-1][1]["progress"]["runId"], run_id)

    def test_operation_11_queues_report_before_terminal_result(self):
        run_id = str(uuid.uuid4())
        self.session.pending_leaf_operation_run = SimpleNamespace(
            next_ordinal=11, run_id=run_id, binding_sha256="5" * 64
        )
        self.snapshot.focused_ordinal = 11
        result = self._result(11, completed=True)
        result.observation["details"]["runId"] = run_id
        result = replace(result, run_id=run_id)
        modules, command_patch = self._modules(result)
        final = {"reportId": str(uuid.uuid4()), "sequence": 8, "transition": "step_succeeded", "stepId": self.step.id}
        self.controller.report = lambda *_args, **_kwargs: self.events.append(("report", final)) or final
        with patch.dict(sys.modules, modules), command_patch, patch.object(
            companion_module.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ):
            self.controller._handle_leaf_operation_execute_request(self._delivery(11))
        self.assertEqual([item[0] for item in self.events], ["report", "result"])
        self.assertEqual(self.events[-1][1]["progress"]["finalReport"], {"reportId": final["reportId"], "sequence": 8})

    def test_stale_or_wrong_delivery_is_rejected_without_command(self):
        deliveries = []
        wrong_parameters = self._delivery(1)
        wrong_parameters["operationParameters"] = {"python": "arbitrary"}
        deliveries.append(wrong_parameters)
        wrong_id = self._delivery(1)
        wrong_id["sourceOperationId"] = IDS[1]
        deliveries.append(wrong_id)
        wrong_ordinal = self._delivery(2)
        deliveries.append(wrong_ordinal)
        stale = self._delivery(1)
        stale["expectedState"]["sequence"] = 6
        deliveries.append(stale)
        for delivery in deliveries:
            self.events.clear()
            result = self._result(1)
            modules, command_patch = self._modules(result)
            with patch.dict(sys.modules, modules), command_patch as execute, patch.object(
                companion_module.CompanionController,
                "shortcut_mutation_blocked",
                new_callable=PropertyMock,
                return_value=False,
            ):
                self.controller._handle_leaf_operation_execute_request(delivery)
            execute.assert_not_called()
            self.assertEqual(self.events[-1][1]["status"], "rejected")

    def test_duplicate_request_is_not_replayed_or_resubmitted(self):
        delivery = self._delivery(1)
        result = self._result(1)
        modules, command_patch = self._modules(result)
        with patch.dict(sys.modules, modules), command_patch as execute, patch.object(
            companion_module.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ):
            self.controller._handle_leaf_operation_execute_request(delivery)
            self.controller._handle_leaf_operation_execute_request(delivery)
        self.assertEqual(execute.call_count, 1)
        self.assertEqual(sum(kind == "result" for kind, _value in self.events), 1)

    def test_native_undo_required_sends_guarded_recovery_result(self):
        result = self._result(1, native_undo_required=True)
        modules, command_patch = self._modules(result)
        with patch.dict(sys.modules, modules), command_patch, patch.object(
            companion_module.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ):
            self.controller._handle_leaf_operation_execute_request(self._delivery(1))
        recovery = self.events[-1][1]
        self.assertEqual(recovery["status"], "recovery_required")
        self.assertIsNone(recovery["progress"])
        self.assertEqual(
            recovery["recoveryReason"],
            {
                "kind": "native_undo_outcome_indeterminate",
                "nativeUndoGuard": {
                    "expectedRestoredCheckpointId": None,
                    "recoveryTokenSha256": "6" * 64,
                },
                "requiresExplicitRecovery": True,
                "automaticReplay": False,
            },
        )
        self.assertEqual(self.controller.status, "Leaf operation recovery required")

    def test_restored_command_failure_submits_failed_without_reading_observation(self):
        failure = command_module.GuidedGeometryCommandFailure(
            operator_status="CANCELLED",
            report_level="ERROR",
            report_message="executor failed after proven restoration",
            report_transition=command_module.GuidedGeometryReportTransition(
                "error", self.step, error="executor failed"
            ),
            native_undo_required=False,
        )
        modules, command_patch = self._modules(failure)
        with patch.dict(sys.modules, modules), command_patch, patch.object(
            companion_module.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ):
            self.controller._handle_leaf_operation_execute_request(self._delivery(1))
        result = self.events[-1][1]
        self.assertEqual(result["status"], "failed")
        self.assertIsNone(result["progress"])

    def test_native_undo_command_failure_reports_recovery_and_keeps_delivery_locked(self):
        failure = command_module.GuidedGeometryCommandFailure(
            operator_status="FINISHED",
            report_level="WARNING",
            report_message="native Undo required",
            report_transition=command_module.GuidedGeometryReportTransition(
                "error", self.step, error="native Undo required"
            ),
            native_undo_required=True,
        )
        modules, command_patch = self._modules(failure)
        with patch.dict(sys.modules, modules), command_patch, patch.object(
            companion_module.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ):
            self.controller._handle_leaf_operation_execute_request(self._delivery(1))
        self.assertEqual(self.events[-1][1]["status"], "recovery_required")
        self.assertEqual(self.controller.status, "Leaf operation recovery required")

    def _operation_ten_run(self, run_id):
        return SimpleNamespace(
            next_ordinal=11,
            run_id=run_id,
            binding_sha256="5" * 64,
            operation_receipts=tuple(
                SimpleNamespace(operation_id=operation_id)
                for operation_id in IDS[:-1]
            ),
        )

    def test_operation_11_observation_failure_restored_to_ten_is_retryable_failed(self):
        run_id = str(uuid.uuid4())
        self.session.pending_leaf_operation_run = self._operation_ten_run(run_id)
        self.snapshot.focused_ordinal = 11
        failed_gate = replace(
            self._result(11),
            run_id=run_id,
            binding_sha256="5" * 64,
            leaf_completed=False,
            next_ordinal=11,
            completed_operation_ids=tuple(IDS[:-1]),
            report_transition=command_module.GuidedGeometryReportTransition(
                "step_observation_failed", self.step
            ),
            report_message="final observation failed",
        )
        modules, command_patch = self._modules(failed_gate)
        self.controller.report = lambda *_args, **_kwargs: self.fail(
            "restored final failure must not advance the Companion report"
        )
        with patch.dict(sys.modules, modules), command_patch, patch.object(
            companion_module.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ):
            self.controller._handle_leaf_operation_execute_request(self._delivery(11))
        result = self.events[-1][1]
        self.assertEqual(result["status"], "failed")
        self.assertIsNone(result["progress"])
        self.assertIn("observation failed", result["error"])
        self.assertEqual(self.controller.status, "Leaf operation failed; retry available")

    def test_operation_11_indeterminate_observation_failure_sends_no_terminal(self):
        run_id = str(uuid.uuid4())
        self.session.pending_leaf_operation_run = SimpleNamespace(
            next_ordinal=12,
            run_id=run_id,
            binding_sha256="5" * 64,
            operation_receipts=tuple(
                SimpleNamespace(operation_id=operation_id) for operation_id in IDS
            ),
        )
        # Authority was captured while ordinal 11 was next, but the command result
        # cannot prove it restored that prefix.
        authority_run = self._operation_ten_run(run_id)
        failed_gate = replace(
            self._result(11),
            run_id=run_id,
            leaf_completed=False,
            report_transition=command_module.GuidedGeometryReportTransition(
                "step_observation_failed", self.step
            ),
            report_message="final observation failed",
        )
        self.snapshot.focused_ordinal = 11
        self.session.pending_leaf_operation_run = authority_run
        modules, command_patch = self._modules(failed_gate)

        def execute_and_drift(**_kwargs):
            self.session.pending_leaf_operation_run = SimpleNamespace(
                next_ordinal=12,
                run_id=run_id,
                binding_sha256="5" * 64,
                operation_receipts=tuple(
                    SimpleNamespace(operation_id=operation_id) for operation_id in IDS
                ),
            )
            return failed_gate

        with patch.dict(sys.modules, modules), patch.object(
            command_module, "execute_guided_geometry_operation", side_effect=execute_and_drift
        ), patch.object(
            companion_module.CompanionController,
            "shortcut_mutation_blocked",
            new_callable=PropertyMock,
            return_value=False,
        ):
            self.controller._handle_leaf_operation_execute_request(self._delivery(11))
        self.assertEqual(self.events[-1][1]["status"], "recovery_required")
        self.assertEqual(
            self.events[-1][1]["recoveryReason"]["kind"],
            "observation_outcome_indeterminate",
        )
        self.assertEqual(self.controller.status, "Leaf operation recovery required")

    def _recovery_challenge(self, *, native_guard=None, delivery=None, prefix=None):
        delivery = self._delivery(1) if delivery is None else delivery
        checkpoint_id = str(uuid.uuid4())
        return {
            "formatVersion": "1.0.0",
            "recoveryId": str(uuid.uuid4()),
            "originalDelivery": delivery,
            "originalSessionFingerprintSha256": "7" * 64,
            "replacementSessionFingerprintSha256": "8" * 64,
            "expectedState": deepcopy(delivery["expectedState"]),
            "acceptedPrefix": deepcopy(prefix)
            if prefix is not None
            else {
                "completedOperationIds": [],
                "runId": None,
                "bindingSha256": None,
                "receiptId": None,
                "nextOrdinal": 1,
                "latestFingerprintSha256": None,
            },
            "authorityProof": {
                "reportId": delivery["expectedState"]["reportId"],
                "sequence": delivery["expectedState"]["sequence"],
                "authorizedStartCheckpointId": checkpoint_id,
            },
            "nativeUndoGuard": native_guard,
            "mode": "read_only_reconcile",
            "automaticReplay": False,
            "requestedAt": delivery["dispatchedAt"],
        }

    def _applied_observation(
        self,
        ordinal,
        *,
        run_id,
        receipt_id,
        before_sha256,
        after_sha256,
    ):
        return {
            "kind": "guided_geometry_operation",
            "satisfied": True,
            "details": {
                "status": "passed",
                "direction": "forward",
                "operationOrdinal": ordinal,
                "operationId": IDS[ordinal - 1],
                "mutating": 2 <= ordinal <= 10,
                "receiptId": receipt_id,
                "runId": run_id,
                "stepId": self.step.id,
                "actionName": ACTION,
                "recipeId": RECIPE,
                "catalogVersion": self.snapshot.catalog_version,
                "beforeFingerprintSha256": before_sha256,
                "afterFingerprintSha256": after_sha256,
                "evidence": {
                    "completedOperations": list(range(1, ordinal + 1)),
                    "preconditionsValidated": ordinal == 1,
                    "completeGraph": ordinal == 11,
                },
            },
        }

    def _assert_recovery_ack_transport_valid(self, ack):
        validator = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            self.controller.instance_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
        )
        self.assertEqual(validator._validate_leaf_operation_recovery_ack(ack), ack)

    def test_recovery_challenge_proves_empty_prefix_without_executing(self):
        challenge = self._recovery_challenge()
        checkpoint_id = challenge["authorityProof"]["authorizedStartCheckpointId"]
        modules, command_patch = self._modules(self._result(1))
        history = modules[f"{PACKAGE_NAME}.infrastructure.native_history"]
        history.native_leaf_checkpoint_attestation = lambda _session: {
            "checkpointId": checkpoint_id,
            "previousCheckpointId": None,
            "operation": "start",
            "marker": {"matched": True},
            "journal": {"snapshotMatchesSession": True},
        }
        with patch.dict(sys.modules, modules), command_patch as execute:
            self.controller._handle_leaf_operation_recovery_request(challenge)
        execute.assert_not_called()
        ack = self.events[-1][1]
        self.assertEqual(ack["outcome"], "prefix_restored")
        self.assertEqual(
            ack["evidence"]["restoration"],
            "prefix_observed_without_native_undo",
        )
        self.assertFalse(ack["retainsTargetLock"])

    def test_recovery_proof_timestamps_follow_a_future_challenge_clock(self):
        delivery = self._delivery(1)
        authority = {
            key: deepcopy(delivery[key])
            for key in transport_module.LEAF_OPERATION_AUTHORITY_KEYS
        }
        delivery["operationBindingSha256"] = (
            transport_module.CompanionTransport._canonical_sha256(authority)
        )
        challenge = self._recovery_challenge(delivery=delivery)
        challenge["requestedAt"] = "2099-08-24T12:00:00Z"
        checkpoint_id = challenge["authorityProof"]["authorizedStartCheckpointId"]
        modules, command_patch = self._modules(self._result(1))
        history = modules[f"{PACKAGE_NAME}.infrastructure.native_history"]
        history.native_leaf_checkpoint_attestation = lambda _session: {
            "checkpointId": checkpoint_id,
            "previousCheckpointId": None,
            "operation": "start",
            "marker": {"matched": True},
            "journal": {"snapshotMatchesSession": True},
        }
        with patch.dict(sys.modules, modules), command_patch as execute:
            self.controller._handle_leaf_operation_recovery_request(challenge)
        execute.assert_not_called()
        ack = self.events[-1][1]
        self.assertGreaterEqual(ack["occurredAt"], challenge["requestedAt"])
        self.assertGreaterEqual(
            ack["evidence"]["currentCheckpoint"]["observedAt"],
            challenge["requestedAt"],
        )
        self._assert_recovery_ack_transport_valid(ack)

    def test_reload_without_runtime_evidence_retires_document_without_replay(self):
        delivery = self._delivery(1)
        authority = {
            key: deepcopy(delivery[key])
            for key in transport_module.LEAF_OPERATION_AUTHORITY_KEYS
        }
        delivery["operationBindingSha256"] = (
            transport_module.CompanionTransport._canonical_sha256(authority)
        )
        challenge = self._recovery_challenge(delivery=delivery)
        self.controller.last_report = None
        modules, command_patch = self._modules(self._result(1))
        with patch.dict(sys.modules, modules), command_patch as execute:
            self.controller._handle_leaf_operation_recovery_request(challenge)
        execute.assert_not_called()
        ack = self.events[-1][1]
        self.assertEqual(ack["outcome"], "document_incarnation_retired")
        self.assertEqual(
            ack["evidence"],
            {
                "kind": "document_incarnation_retired",
                "reason": "runtime_recovery_evidence_lost",
                "mutationOutcome": "indeterminate",
                "requiresFreshDocumentIncarnation": True,
            },
        )
        self._assert_recovery_ack_transport_valid(ack)

    def test_reload_with_native_guard_and_changed_report_retires_document(self):
        delivery = self._delivery(1)
        authority = {
            key: deepcopy(delivery[key])
            for key in transport_module.LEAF_OPERATION_AUTHORITY_KEYS
        }
        delivery["operationBindingSha256"] = (
            transport_module.CompanionTransport._canonical_sha256(authority)
        )
        challenge_checkpoint_id = str(uuid.uuid4())
        challenge = self._recovery_challenge(
            delivery=delivery,
            native_guard={
                "expectedRestoredCheckpointId": challenge_checkpoint_id,
                "recoveryTokenSha256": "9" * 64,
            },
        )
        self.controller.last_report = {
            "protocolVersion": "1.6.0",
            "reportId": str(uuid.uuid4()),
            "sequence": delivery["expectedState"]["sequence"] + 1,
        }
        modules, command_patch = self._modules(self._result(1))
        with patch.dict(sys.modules, modules), command_patch as execute:
            self.controller._handle_leaf_operation_recovery_request(challenge)
        execute.assert_not_called()
        ack = self.events[-1][1]
        self.assertEqual(ack["outcome"], "document_incarnation_retired")
        self.assertEqual(
            ack["evidence"]["reason"],
            "native_undo_witness_lost_after_reload",
        )
        self._assert_recovery_ack_transport_valid(ack)

    def test_retirement_confirmation_quarantines_ui_without_consuming_witness(self):
        recovery_id = str(uuid.uuid4())
        self.controller._pending_leaf_operation_recovery_witness_id = recovery_id
        modules, _command_patch = self._modules(self._result(1))
        history = modules[f"{PACKAGE_NAME}.infrastructure.native_history"]
        consumed = []
        history.consume_native_undo_restoration_witness = lambda: consumed.append(True)
        with patch.dict(sys.modules, modules):
            self.controller._acknowledge_leaf_operation_recovery(
                recovery_id, "document_incarnation_retired"
            )
        self.assertEqual(consumed, [])
        self.assertEqual(self.controller.status, "Current Blender document quarantined")
        self.assertIn("fresh Blender document", self.controller.error)

    def test_recovery_challenge_verifies_positive_prefix_without_replay(self):
        challenge = self._recovery_challenge()
        delivery = self._delivery(2)
        challenge["originalDelivery"] = delivery
        challenge["expectedState"] = deepcopy(delivery["expectedState"])
        challenge["authorityProof"]["reportId"] = delivery["expectedState"]["reportId"]
        challenge["authorityProof"]["sequence"] = delivery["expectedState"]["sequence"]
        receipt_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        receipt = SimpleNamespace(operation_id=IDS[0], after_sha256="a" * 64)
        self.session.pending_leaf_operation_run = SimpleNamespace(
            run_id=run_id,
            binding_sha256="b" * 64,
            leaf_receipt_id=receipt_id,
            next_ordinal=2,
            operation_receipts=(receipt,),
            partial_action_receipt=None,
        )
        challenge["acceptedPrefix"] = {
            "completedOperationIds": [IDS[0]],
            "runId": run_id,
            "bindingSha256": "b" * 64,
            "receiptId": receipt_id,
            "nextOrdinal": 2,
            "latestFingerprintSha256": "a" * 64,
        }
        modules, command_patch = self._modules(self._result(2))
        history = modules[f"{PACKAGE_NAME}.infrastructure.native_history"]
        history.native_leaf_checkpoint_attestation = lambda _session: {
            "checkpointId": str(uuid.uuid4()),
            "previousCheckpointId": challenge["authorityProof"][
                "authorizedStartCheckpointId"
            ],
            "operation": "leaf_operation",
            "marker": {"matched": True},
            "journal": {"snapshotMatchesSession": True},
        }
        verified = []
        guided = modules[f"{PACKAGE_NAME}.infrastructure.guided_geometry_operations"]
        guided.verify_transform_geometry_stage = (
            lambda **kwargs: verified.append(kwargs) or True
        )
        with patch.dict(sys.modules, modules), command_patch as execute:
            self.controller._handle_leaf_operation_recovery_request(challenge)
        execute.assert_not_called()
        self.assertEqual(len(verified), 1)
        self.assertEqual(verified[0]["completed_operations"], (1,))
        self.assertTrue(verified[0]["rebind_after_native_restore"])
        self.assertEqual(self.events[-1][1]["outcome"], "prefix_restored")

    def test_recovery_reports_applied_operation_02_without_replay(self):
        delivery = self._delivery(2)
        authority = {
            key: deepcopy(delivery[key])
            for key in transport_module.LEAF_OPERATION_AUTHORITY_KEYS
        }
        delivery["operationBindingSha256"] = transport_module.CompanionTransport._canonical_sha256(
            authority
        )
        run_id = str(uuid.uuid4())
        receipt_id = str(uuid.uuid4())
        first = SimpleNamespace(
            operation_id=IDS[0],
            after_sha256="a" * 64,
            observation=self._applied_observation(
                1,
                run_id=run_id,
                receipt_id=receipt_id,
                before_sha256="a" * 64,
                after_sha256="a" * 64,
            ),
        )
        second = SimpleNamespace(
            operation_id=IDS[1],
            after_sha256="b" * 64,
            observation=self._applied_observation(
                2,
                run_id=run_id,
                receipt_id=receipt_id,
                before_sha256="a" * 64,
                after_sha256="b" * 64,
            ),
        )
        run = SimpleNamespace(
            run_id=run_id,
            step_id=self.step.id,
            action_name=ACTION,
            recipe_id=RECIPE,
            catalog_version=self.snapshot.catalog_version,
            binding_sha256="5" * 64,
            leaf_receipt_id=receipt_id,
            operation_ids=tuple(IDS),
            next_ordinal=3,
            operation_receipts=(first, second),
            partial_action_receipt=SimpleNamespace(receipt_id=receipt_id),
            status="in_progress",
        )
        self.session.pending_leaf_operation_run = run
        self.session.leaf_operation_runs[self.step.id] = run
        challenge = self._recovery_challenge(
            delivery=delivery,
            prefix={
                "completedOperationIds": [IDS[0]],
                "runId": run_id,
                "bindingSha256": run.binding_sha256,
                "receiptId": receipt_id,
                "nextOrdinal": 2,
                "latestFingerprintSha256": "a" * 64,
            },
        )
        checkpoint_id = str(uuid.uuid4())
        modules, command_patch = self._modules(self._result(2))
        history = modules[f"{PACKAGE_NAME}.infrastructure.native_history"]
        history.native_leaf_checkpoint_attestation = lambda _session: {
            "checkpointId": checkpoint_id,
            "previousCheckpointId": challenge["authorityProof"][
                "authorizedStartCheckpointId"
            ],
            "operation": "leaf_operation",
            "marker": {"matched": True},
            "journal": {"snapshotMatchesSession": True},
        }
        with patch.dict(sys.modules, modules), command_patch as execute:
            self.controller._handle_leaf_operation_recovery_request(challenge)
        execute.assert_not_called()
        ack = self.events[-1][1]
        self.assertEqual(ack["outcome"], "operation_applied")
        self.assertEqual(
            ack["evidence"]["terminalResult"]["progress"]["completedOperationIds"],
            list(IDS[:2]),
        )
        self._assert_recovery_ack_transport_valid(ack)

    def test_applied_recovery_local_rejection_clears_pending_and_defers(self):
        delivery = self._delivery(2)
        authority = {
            key: deepcopy(delivery[key])
            for key in transport_module.LEAF_OPERATION_AUTHORITY_KEYS
        }
        delivery["operationBindingSha256"] = (
            transport_module.CompanionTransport._canonical_sha256(authority)
        )
        run_id = str(uuid.uuid4())
        receipt_id = str(uuid.uuid4())
        first = SimpleNamespace(
            operation_id=IDS[0],
            after_sha256="a" * 64,
            observation=self._applied_observation(
                1,
                run_id=run_id,
                receipt_id=receipt_id,
                before_sha256="a" * 64,
                after_sha256="a" * 64,
            ),
        )
        second = SimpleNamespace(
            operation_id=IDS[1],
            after_sha256="b" * 64,
            observation=self._applied_observation(
                2,
                run_id=run_id,
                receipt_id=receipt_id,
                before_sha256="a" * 64,
                after_sha256="b" * 64,
            ),
        )
        run = SimpleNamespace(
            run_id=run_id,
            step_id=self.step.id,
            action_name=ACTION,
            recipe_id=RECIPE,
            catalog_version=self.snapshot.catalog_version,
            binding_sha256="5" * 64,
            leaf_receipt_id=receipt_id,
            operation_ids=tuple(IDS),
            next_ordinal=3,
            operation_receipts=(first, second),
            partial_action_receipt=SimpleNamespace(receipt_id=receipt_id),
            status="in_progress",
        )
        self.session.pending_leaf_operation_run = run
        self.session.leaf_operation_runs[self.step.id] = run
        challenge = self._recovery_challenge(
            delivery=delivery,
            prefix={
                "completedOperationIds": [IDS[0]],
                "runId": run_id,
                "bindingSha256": run.binding_sha256,
                "receiptId": receipt_id,
                "nextOrdinal": 2,
                "latestFingerprintSha256": "a" * 64,
            },
        )
        modules, command_patch = self._modules(self._result(2))
        history = modules[f"{PACKAGE_NAME}.infrastructure.native_history"]
        history.native_leaf_checkpoint_attestation = lambda _session: {
            "checkpointId": str(uuid.uuid4()),
            "previousCheckpointId": challenge["authorityProof"][
                "authorizedStartCheckpointId"
            ],
            "operation": "leaf_operation",
            "marker": {"matched": True},
            "journal": {"snapshotMatchesSession": True},
        }
        with patch.dict(sys.modules, modules), command_patch as execute, patch.object(
            self.controller._transport,
            "submit_leaf_operation_recovery_ack",
            side_effect=ValueError("strict local rejection"),
        ):
            self.controller._handle_leaf_operation_recovery_request(challenge)
        execute.assert_not_called()
        self.assertIsNone(self.controller._pending_leaf_operation_recovery_ack_id)
        self.assertEqual(
            self.controller._active_leaf_operation_recovery_challenge, challenge
        )
        self.assertIn("strict local rejection", self.controller.error)
        self.assertEqual(self.controller.status, "Leaf operation recovery required")

    def test_recovery_reports_applied_operation_11_with_formal_receipt(self):
        delivery = self._delivery(11)
        authority = {
            key: deepcopy(delivery[key])
            for key in transport_module.LEAF_OPERATION_AUTHORITY_KEYS
        }
        delivery["operationBindingSha256"] = transport_module.CompanionTransport._canonical_sha256(
            authority
        )
        run_id = str(uuid.uuid4())
        receipt_id = str(uuid.uuid4())
        receipts = []
        fingerprint = "a" * 64
        for ordinal in range(1, 12):
            before = fingerprint
            after = before if ordinal in {1, 11} else f"{ordinal % 10}" * 64
            receipts.append(
                SimpleNamespace(
                    operation_id=IDS[ordinal - 1],
                    after_sha256=after,
                    observation=self._applied_observation(
                        ordinal,
                        run_id=run_id,
                        receipt_id=receipt_id,
                        before_sha256=before,
                        after_sha256=after,
                    ),
                )
            )
            fingerprint = after
        formal_receipt = SimpleNamespace(receipt_id=receipt_id)
        run = SimpleNamespace(
            run_id=run_id,
            step_id=self.step.id,
            action_name=ACTION,
            recipe_id=RECIPE,
            catalog_version=self.snapshot.catalog_version,
            binding_sha256="5" * 64,
            leaf_receipt_id=receipt_id,
            operation_ids=tuple(IDS),
            next_ordinal=12,
            operation_receipts=tuple(receipts),
            partial_action_receipt=None,
            status="completed",
        )
        self.session.pending_leaf_operation_run = None
        self.session.leaf_operation_runs[self.step.id] = run
        self.session.receipts[self.step.id] = formal_receipt
        challenge = self._recovery_challenge(
            delivery=delivery,
            prefix={
                "completedOperationIds": list(IDS[:10]),
                "runId": run_id,
                "bindingSha256": run.binding_sha256,
                "receiptId": receipt_id,
                "nextOrdinal": 11,
                "latestFingerprintSha256": receipts[9].after_sha256,
            },
        )
        final_report = {
            "protocolVersion": "1.6.0",
            "reportId": str(uuid.uuid4()),
            "sequence": delivery["expectedState"]["sequence"] + 1,
            "transition": "step_succeeded",
            "stepId": self.step.id,
        }
        self.controller.last_report = final_report
        checkpoint_id = str(uuid.uuid4())
        verified = []
        modules, command_patch = self._modules(self._result(11, completed=True))
        history = modules[f"{PACKAGE_NAME}.infrastructure.native_history"]
        history.native_leaf_checkpoint_attestation = lambda _session: {
            "checkpointId": checkpoint_id,
            "previousCheckpointId": challenge["authorityProof"][
                "authorizedStartCheckpointId"
            ],
            "operation": "next",
            "marker": {"matched": True},
            "journal": {"snapshotMatchesSession": True},
        }
        guided = modules[f"{PACKAGE_NAME}.infrastructure.guided_geometry_operations"]
        guided.verify_transform_geometry_stage = (
            lambda **kwargs: verified.append(kwargs) or True
        )
        with patch.dict(sys.modules, modules), command_patch as execute:
            self.controller._handle_leaf_operation_recovery_request(challenge)
        execute.assert_not_called()
        self.assertIs(verified[0]["partial_receipt"], formal_receipt)
        ack = self.events[-1][1]
        self.assertEqual(ack["outcome"], "operation_applied")
        self.assertEqual(
            ack["evidence"]["terminalResult"]["progress"]["finalReport"],
            {"reportId": final_report["reportId"], "sequence": final_report["sequence"]},
        )
        self._assert_recovery_ack_transport_valid(ack)

    def test_native_undo_witness_is_consumed_only_after_acknowledgement(self):
        restored_id = str(uuid.uuid4())
        guard = {
            "expectedRestoredCheckpointId": restored_id,
            "recoveryTokenSha256": "9" * 64,
        }
        challenge = self._recovery_challenge(native_guard=guard)
        challenge["authorityProof"]["authorizedStartCheckpointId"] = restored_id
        modules, command_patch = self._modules(self._result(1))
        history = modules[f"{PACKAGE_NAME}.infrastructure.native_history"]
        previous_id = str(uuid.uuid4())
        history.native_leaf_checkpoint_attestation = lambda _session: {
            "checkpointId": restored_id,
            "previousCheckpointId": previous_id,
            "operation": "start",
            "marker": {"matched": True},
            "journal": {"snapshotMatchesSession": True},
        }
        history.peek_native_undo_restoration_witness = lambda: SimpleNamespace(
            source_checkpoint_id=str(uuid.uuid4()),
            restored_checkpoint_id=restored_id,
            recovery_token_sha256="9" * 64,
            restored_at="2026-08-24T12:00:01Z",
            recovery_probe_satisfied=True,
        )
        consumed = []
        history.consume_native_undo_restoration_witness = lambda: consumed.append(True)
        with patch.dict(sys.modules, modules), command_patch as execute:
            self.controller._handle_leaf_operation_recovery_request(challenge)
            self.assertEqual(consumed, [])
            ack = self.events[-1][1]
            self.assertEqual(ack["evidence"]["restoration"], "native_undo_restored")
            self.controller._acknowledge_leaf_operation_recovery(
                challenge["recoveryId"]
            )
        execute.assert_not_called()
        self.assertEqual(consumed, [True])

    def test_unresolved_recovery_waits_for_state_change_without_ack_churn(self):
        restored_id = str(uuid.uuid4())
        guard = {
            "expectedRestoredCheckpointId": restored_id,
            "recoveryTokenSha256": "9" * 64,
        }
        challenge = self._recovery_challenge(native_guard=guard)
        challenge["authorityProof"]["authorizedStartCheckpointId"] = restored_id
        modules, command_patch = self._modules(self._result(1))
        history = modules[f"{PACKAGE_NAME}.infrastructure.native_history"]
        previous_id = str(uuid.uuid4())
        history.native_leaf_checkpoint_attestation = lambda _session: {
            "checkpointId": restored_id,
            "previousCheckpointId": previous_id,
            "operation": "start",
            "marker": {"matched": True},
            "journal": {"snapshotMatchesSession": True},
        }
        witness = [None]
        history.peek_native_undo_restoration_witness = lambda: witness[0]
        with patch.dict(sys.modules, modules), command_patch as execute:
            before = len(self.events)
            self.controller._handle_leaf_operation_recovery_request(challenge)
            self.assertEqual(len(self.events), before)
            self.assertEqual(
                self.controller.status, "Leaf operation recovery required"
            )
            self.controller._leaf_operation_recovery_retry_at = 0.0
            self.controller._retry_deferred_leaf_operation_recovery()
            self.assertEqual(len(self.events), before)
            witness[0] = SimpleNamespace(
                source_checkpoint_id=str(uuid.uuid4()),
                restored_checkpoint_id=restored_id,
                recovery_token_sha256="9" * 64,
                restored_at="2026-08-24T12:00:01Z",
                recovery_probe_satisfied=True,
            )
            self.controller._leaf_operation_recovery_retry_at = 0.0
            self.controller._retry_deferred_leaf_operation_recovery()
        execute.assert_not_called()
        self.assertEqual(self.events[-1][1]["outcome"], "prefix_restored")

    def test_non_native_recovery_confirmation_updates_ui_without_consuming_witness(self):
        challenge = self._recovery_challenge()
        self.controller.status = "Leaf operation recovery required"
        self.controller.error = "waiting"
        self.controller._acknowledge_leaf_operation_recovery(
            challenge["recoveryId"], "unresolved_current_state"
        )
        self.assertEqual(self.controller.status, "Leaf operation recovery required")
        self.controller._acknowledge_leaf_operation_recovery(
            challenge["recoveryId"], "prefix_restored"
        )
        self.assertEqual(self.controller.status, "Leaf operation recovery reconciled")
        self.assertEqual(self.controller.error, "")


if __name__ == "__main__":
    unittest.main()
