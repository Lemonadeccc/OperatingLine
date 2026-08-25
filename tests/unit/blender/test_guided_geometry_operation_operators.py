"""Pure Python contracts for guided Transform Geometry operation operators."""

from importlib import import_module
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_guided_geometry_operator_test"


@dataclass(frozen=True)
class _OperationReceipt:
    operation_id: str
    ordinal: int
    before_sha256: str
    after_sha256: str
    observation: dict | None = None


@dataclass(frozen=True)
class _Run:
    run_id: str
    binding_sha256: str
    leaf_receipt_id: str
    recipe_id: str
    catalog_version: str
    operation_receipts: tuple
    partial_action_receipt: object | None
    next_ordinal: int


class _Companion:
    proposed_plan = None
    shortcut_mutation_blocked = False

    def __init__(self, events):
        self.events = events
        self.revision_request_status = ""
        self._revision_references = set()

    def report(self, transition, *, step=None, error=None, **_kwargs):
        self.events.append(("companion", transition, step, error))

    def has_revision_reference(self, _scope, step_id):
        return step_id in self._revision_references

    def add_revision_reference(self, _scope, step_id):
        self._revision_references.add(step_id)
        self.events.append(("revision_reference", step_id))

    def set_revision_parameter_edit(self, step_id, argument_name, value):
        self.events.append(("revision_parameter", step_id, argument_name, value))


class _Session:
    def __init__(self, step, snapshot, events, run=None):
        self.guidance_step = step
        self.snapshot = snapshot
        self.events = events
        self.pending_leaf_operation_run = run
        self.receipts = {}
        self.active_index = -1
        self.steps = (step,)
        self.active_step = None

    def snapshot_state(self):
        return SimpleNamespace(pending_leaf_operation_run=self.pending_leaf_operation_run)

    def rebase_leaf_operation_replay(
        self,
        snapshot,
        *,
        step_id,
        original_run,
        replayed_run,
    ):
        self.events.append(("rebase", step_id, original_run, replayed_run))
        return SimpleNamespace(
            prepared=snapshot,
            replayed_run=replayed_run,
        )

    def begin_leaf_operation_run(self, step, **kwargs):
        self.events.append(("begin", step.id, kwargs))
        if self.pending_leaf_operation_run is None:
            self.pending_leaf_operation_run = _Run(
                run_id="run-1",
                binding_sha256="b" * 64,
                leaf_receipt_id="leaf-receipt",
                recipe_id=kwargs["recipe_id"],
                catalog_version=kwargs["catalog_version"],
                operation_receipts=(),
                partial_action_receipt=None,
                next_ordinal=1,
            )
        return self.pending_leaf_operation_run

    def record_leaf_operation(self, step, **kwargs):
        self.events.append(("record", step.id, kwargs))
        old = self.pending_leaf_operation_run
        receipt = _OperationReceipt(
            operation_id=kwargs["operation_id"],
            ordinal=kwargs["ordinal"],
            before_sha256=kwargs["before_sha256"],
            after_sha256=kwargs["after_sha256"],
        )
        self.pending_leaf_operation_run = _Run(
            run_id=old.run_id,
            binding_sha256=old.binding_sha256,
            leaf_receipt_id=old.leaf_receipt_id,
            recipe_id=old.recipe_id,
            catalog_version=old.catalog_version,
            operation_receipts=old.operation_receipts + (receipt,),
            partial_action_receipt=kwargs["partial_action_receipt"],
            next_ordinal=kwargs["ordinal"] + 1,
        )
        return self.pending_leaf_operation_run

    def complete_leaf_operation_run(self, step, *, run_id):
        self.events.append(("complete", step.id, run_id))
        self.pending_leaf_operation_run = None

    def rewind_leaf_operation(self, step, **kwargs):
        self.events.append(("rewind", step.id, kwargs))
        old = self.pending_leaf_operation_run
        remaining = old.operation_receipts[:-1]
        self.pending_leaf_operation_run = _Run(
            run_id=old.run_id,
            binding_sha256=old.binding_sha256,
            leaf_receipt_id=old.leaf_receipt_id,
            recipe_id=old.recipe_id,
            catalog_version=old.catalog_version,
            operation_receipts=remaining,
            partial_action_receipt=kwargs["partial_action_receipt"],
            next_ordinal=kwargs["ordinal"],
        )
        return self.pending_leaf_operation_run

    def abort_leaf_operation_run(self):
        self.events.append(("abort", self.pending_leaf_operation_run.run_id))
        self.pending_leaf_operation_run = None
        return self.guidance_step

    def discard_empty_leaf_operation_run(self, *, run_id):
        self.events.append(("discard", run_id))
        self.pending_leaf_operation_run = None


def _operations():
    return tuple(
        SimpleNamespace(
            operation_id=f"transform-geometry-{ordinal:02d}",
            ordinal=ordinal,
            label=f"Operation {ordinal:02d}",
            parameters=(),
            connection=(SimpleNamespace() if ordinal in {9, 10} else None),
        )
        for ordinal in range(1, 12)
    )


def _snapshot(operations, *, focused_ordinal):
    return SimpleNamespace(
        recipe_id="blender.geometry_nodes.create_transform.semantic",
        catalog_version="1.42.0",
        cursor_token="cursor-1",
        focused_ordinal=focused_ordinal,
        focused_operation=operations[focused_ordinal - 1],
        operations=operations,
        can_focus_next=focused_ordinal < len(operations),
        can_focus_back=focused_ordinal > 1,
    )


def _run(*, completed):
    receipts = tuple(
        _OperationReceipt(
            operation_id=f"transform-geometry-{ordinal:02d}",
            ordinal=ordinal,
            before_sha256=f"{ordinal - 1:064x}",
            after_sha256=f"{ordinal:064x}",
        )
        for ordinal in range(1, completed + 1)
    )
    return _Run(
        run_id="run-1",
        binding_sha256="b" * 64,
        leaf_receipt_id="leaf-receipt",
        recipe_id="blender.geometry_nodes.create_transform.semantic",
        catalog_version="1.42.0",
        operation_receipts=receipts,
        partial_action_receipt=(SimpleNamespace(id="partial") if completed >= 2 else None),
        next_ordinal=completed + 1,
    )


def _load_operators(session, companion, events):
    fake_bpy = ModuleType("bpy")
    fake_bpy.types = SimpleNamespace(Operator=object, Panel=object)
    fake_bpy.props = SimpleNamespace(
        StringProperty=lambda **_kwargs: None,
        IntProperty=lambda **_kwargs: None,
        BoolProperty=lambda **_kwargs: None,
        FloatProperty=lambda **_kwargs: None,
        EnumProperty=lambda **_kwargs: None,
        FloatVectorProperty=lambda **_kwargs: None,
    )
    sys.modules["bpy"] = fake_bpy

    package = ModuleType(PACKAGE_NAME)
    package.__path__ = [str(PACKAGE_ROOT)]
    package.get_session = lambda: session
    package.get_companion = lambda: companion
    sys.modules[PACKAGE_NAME] = package

    application = ModuleType(f"{PACKAGE_NAME}.application")
    application.__path__ = [str(PACKAGE_ROOT / "application")]
    class ObservationGateError(Exception):
        def __init__(self, step, gate):
            super().__init__(gate.message)
            self.step = step
            self.gate = gate

    application.ObservationGateError = ObservationGateError
    sys.modules[application.__name__] = application
    provider_handoff = ModuleType(f"{PACKAGE_NAME}.application.provider_handoff")
    provider_handoff.PROVIDER_AUTHORITY_UNAVAILABLE = "unavailable"
    sys.modules[provider_handoff.__name__] = provider_handoff

    infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
    infrastructure.prepare_native_history = (
        lambda _session, _scene, operation: events.append(("prepare", operation))
    )
    infrastructure.commit_native_history = (
        lambda _session, **_kwargs: events.append(("commit",))
    )
    infrastructure.cancel_native_history = lambda: events.append(("cancel",))
    infrastructure.prepared_native_history_changed = lambda _session: False
    infrastructure.clear_native_rna_badge = lambda: events.append(("clear_badge",))
    infrastructure.disable_overlay = lambda *_args: None
    infrastructure.enable_overlay = lambda *_args: None
    infrastructure.overlay_enabled = lambda: False
    infrastructure.remember_native_rna_badge = lambda *_args, **_kwargs: True
    infrastructure.remove_factory_startup_objects = lambda *_args: False
    infrastructure.resolve_resource = lambda *_args: None
    infrastructure.try_activate_native_rna_button = lambda *_args, **_kwargs: None
    sys.modules[infrastructure.__name__] = infrastructure

    presentation = ModuleType(f"{PACKAGE_NAME}.presentation")
    presentation.__path__ = [str(PACKAGE_ROOT / "presentation")]
    sys.modules[presentation.__name__] = presentation

    guided_control = ModuleType(f"{PACKAGE_NAME}.presentation.guided_control_dock")
    guided_control.TRANSFORM_GEOMETRY_ACTION_NAME = (
        "blender.geometry_nodes.create_transform"
    )
    guided_control.TRANSFORM_GEOMETRY_RECIPE_ID = (
        "blender.geometry_nodes.create_transform.semantic"
    )
    guided_control.LIGHT_TRAILS_ACTION_NAME = (
        "blender.geometry_nodes.create_light_trails"
    )
    guided_control.LIGHT_TRAILS_RECIPE_ID = (
        "blender.geometry_nodes.create_light_trails.semantic"
    )
    guided_control.POSE_ANIMATION_ACTION_NAME = (
        "blender.animation.create_pose_keyframes"
    )
    guided_control.POSE_ANIMATION_RECIPE_ID = (
        "blender.animation.create_pose_keyframes.semantic"
    )
    guided_control.ARMATURE_ACTION_NAME = "blender.rig.create_armature"
    guided_control.ARMATURE_RECIPE_ID = "blender.rig.create_armature.semantic"
    guided_control.SKIN_WEIGHTS_ACTION_NAME = "blender.rig.bind_skin_weights"
    guided_control.SKIN_WEIGHTS_RECIPE_ID = (
        "blender.rig.bind_skin_weights.semantic"
    )
    guided_control.SOLIDIFY_ACTION_NAME = "blender.modifier.add_solidify"
    guided_control.SOLIDIFY_RECIPE_ID = "blender.modifier.add_solidify.semantic"
    guided_control.BEVEL_MODIFIER_ACTION_NAME = "blender.modifier.add_bevel"
    guided_control.BEVEL_MODIFIER_RECIPE_ID = "blender.modifier.add_bevel.semantic"
    guided_control.SUBDIVISION_SURFACE_ACTION_NAME = (
        "blender.modifier.add_subdivision_surface"
    )
    guided_control.SUBDIVISION_SURFACE_RECIPE_ID = (
        "blender.modifier.add_subdivision_surface.semantic"
    )
    guided_control.MIRROR_ACTION_NAME = "blender.modifier.add_mirror"
    guided_control.MIRROR_RECIPE_ID = "blender.modifier.add_mirror.semantic"
    guided_control.EDIT_BEVEL_ACTION_NAME = "blender.mesh.edit_bevel_edges"
    guided_control.EDIT_BEVEL_RECIPE_ID = "blender.mesh.edit_bevel_edges.semantic"
    guided_control.EDIT_INSET_ACTION_NAME = "blender.mesh.edit_inset_faces"
    guided_control.EDIT_INSET_RECIPE_ID = "blender.mesh.edit_inset_faces.semantic"
    guided_control.EDIT_TRIANGULATE_ACTION_NAME = "blender.mesh.edit_triangulate"
    guided_control.EDIT_TRIANGULATE_RECIPE_ID = (
        "blender.mesh.edit_triangulate.semantic"
    )
    guided_control.EDIT_EXTRUDE_REGION_ACTION_NAME = (
        "blender.mesh.edit_extrude_region"
    )
    guided_control.EDIT_EXTRUDE_REGION_RECIPE_ID = (
        "blender.mesh.edit_extrude_region.semantic"
    )
    guided_control.EDIT_POKE_ACTION_NAME = "blender.mesh.edit_poke_faces"
    guided_control.EDIT_POKE_RECIPE_ID = "blender.mesh.edit_poke_faces.semantic"
    guided_control.MATERIAL_PALETTE_ACTION_NAME = (
        "blender.material.create_palette_and_assign"
    )
    guided_control.MATERIAL_PALETTE_RECIPE_ID = (
        "blender.material.create_palette_and_assign.semantic"
    )

    def guided_control_model(step, snapshot, _run):
        return SimpleNamespace(
            step_id=step.id,
            cursor_token=snapshot.cursor_token,
            operation_execution_available=True,
            vectors=tuple(
                SimpleNamespace(operation_id=operation.operation_id)
                for operation in snapshot.operations
                if operation.parameters
                and isinstance(operation.parameters[0].value, (list, tuple))
            ),
            scalars=tuple(
                SimpleNamespace(operation_id=operation.operation_id)
                for operation in snapshot.operations
                if operation.parameters
                and not isinstance(operation.parameters[0].value, (list, tuple))
            ),
        )

    guided_control.guided_control_dock_model = guided_control_model
    sys.modules[guided_control.__name__] = guided_control

    targeting = ModuleType(f"{PACKAGE_NAME}.presentation.guided_native_targeting")
    targeting.resolve_guided_geometry_native_target = lambda *_args, **_kwargs: None
    sys.modules[targeting.__name__] = targeting

    native_guidance = ModuleType(f"{PACKAGE_NAME}.presentation.native_menu_guidance")
    native_guidance.leaf_guidance_snapshot = lambda _step: session.snapshot
    native_guidance.focus_next_leaf_operation = (
        lambda *_args: events.append(("focus_next",)) or True
    )
    native_guidance.focus_previous_leaf_operation = (
        lambda *_args: events.append(("focus_previous",)) or True
    )
    native_guidance.refresh_native_menu_guidance = (
        lambda: events.append(("refresh",))
    )
    native_guidance.reset_native_menu_guidance = (
        lambda: events.append(("reset_guidance",))
    )
    for name in (
        "disable_native_menu_guidance",
        "enable_native_menu_guidance",
        "guided_menu_action_matches",
        "interaction_guidance_snapshot",
        "native_menu_snapshot",
        "retry_leaf_operation",
    ):
        setattr(native_guidance, name, lambda *_args, **_kwargs: None)
    sys.modules[native_guidance.__name__] = native_guidance

    module_name = f"{PACKAGE_NAME}.presentation.operators"
    sys.modules.pop(module_name, None)
    return import_module(module_name)


def _operator(operators, class_name, *, ordinal, run_id=""):
    operator = getattr(operators, class_name)()
    operator.step_id = "geometry-step"
    operator.operation_id = f"transform-geometry-{ordinal:02d}"
    operator.ordinal = ordinal
    operator.cursor_token = "cursor-1"
    operator.run_id = run_id
    operator.reports = []
    operator.report = lambda level, message: operator.reports.append((level, message))
    return operator


class GuidedGeometryOperationOperatorTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.operations = _operations()
        self.step = SimpleNamespace(
            id="geometry-step",
            action=SimpleNamespace(
                name="blender.geometry_nodes.create_transform",
                arguments={"translation": [1.0, 2.0, 3.0]},
            ),
        )
        self.context = SimpleNamespace(scene=SimpleNamespace())

    def _fixture(self, *, focused_ordinal, run=None):
        snapshot = _snapshot(self.operations, focused_ordinal=focused_ordinal)
        session = _Session(self.step, snapshot, self.events, run=run)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        operators.validate_geometry_nodes_transform = (
            lambda arguments: self.events.append(("validate", arguments)) or "definition"
        )
        operators.verify_transform_geometry_stage = lambda **_kwargs: True
        operators.native_history_requires_native_undo = lambda: False
        operators.is_action_host_state_restored_error = lambda _error: False
        operators._native_history_recovery = lambda snapshot, probe: SimpleNamespace(
            snapshot=snapshot,
            recovery_probe=probe,
        )
        return operators, session, companion

    def test_light_trails_integer_control_stages_exact_revision_parameter(self):
        parameter = SimpleNamespace(
            name="trailCount",
            value=12,
            resolved=True,
        )
        operation = SimpleNamespace(
            operation_id="projection.light-trails.trail-count",
            ordinal=7,
            label="Set Trail Count",
            parameters=(parameter,),
            connection=None,
        )
        step = SimpleNamespace(
            id="light-trails-step",
            action=SimpleNamespace(
                name="blender.geometry_nodes.create_light_trails",
                arguments={"trailCount": 12},
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.geometry_nodes.create_light_trails.semantic",
            catalog_version="1.53.0",
            cursor_token="light-trails-cursor",
            focused_ordinal=7,
            focused_operation=operation,
            operations=(operation,),
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        operator = operators.OPERATINGLINE_OT_edit_guided_geometry_parameter()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = operation.ordinal
        operator.cursor_token = snapshot.cursor_token
        operator.report = lambda level, message: self.events.append(
            ("operator_report", level, message)
        )
        context = SimpleNamespace(
            window_manager=SimpleNamespace(
                invoke_props_dialog=lambda *_args, **_kwargs: {"RUNNING_MODAL"}
            )
        )

        self.assertEqual(operator.invoke(context, None), {"RUNNING_MODAL"})
        self.assertEqual(operator.value_kind, "integer")
        self.assertEqual(operator.integer_value, 12)
        operator.integer_value = 16

        self.assertEqual(operator.execute(None), {"FINISHED"})
        self.assertIn(("revision_reference", step.id), self.events)
        self.assertIn(
            ("revision_parameter", step.id, "trailCount", 16),
            self.events,
        )

    def test_stale_cursor_is_rejected_before_native_history(self):
        operators, _session, _companion = self._fixture(focused_ordinal=1)
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=1,
        )
        operator.cursor_token = "stale-cursor"

        result = operator.execute(self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertNotIn("prepare", [event[0] for event in self.events])
        self.assertIn("changed", operator.reports[-1][1])

    def test_stale_run_id_is_rejected_before_native_history(self):
        operators, _session, _companion = self._fixture(
            focused_ordinal=2,
            run=_run(completed=1),
        )
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=2,
            run_id="stale-run",
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertNotIn("prepare", [event[0] for event in self.events])
        self.assertIn("run changed", operator.reports[-1][1])

    def test_stale_focused_ordinal_is_rejected_before_executor_or_history(self):
        operators, _session, _companion = self._fixture(focused_ordinal=1)
        operators.execute_transform_geometry_operation = lambda **_kwargs: (
            self.events.append(("execute",))
        )
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=2,
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertNotIn("execute", [event[0] for event in self.events])
        self.assertNotIn("prepare", [event[0] for event in self.events])
        self.assertIn("Focus this numbered instruction", operator.reports[-1][1])

    def test_stale_operation_id_is_rejected_before_executor_or_history(self):
        operators, _session, _companion = self._fixture(focused_ordinal=1)
        operators.execute_transform_geometry_operation = lambda **_kwargs: (
            self.events.append(("execute",))
        )
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=1,
        )
        operator.operation_id = "transform-geometry-stale"

        result = operator.execute(self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertNotIn("execute", [event[0] for event in self.events])
        self.assertNotIn("prepare", [event[0] for event in self.events])
        self.assertIn("operation changed", operator.reports[-1][1])

    def test_stale_next_ordinal_is_rejected_before_executor_or_history(self):
        operators, _session, _companion = self._fixture(
            focused_ordinal=3,
            run=_run(completed=1),
        )
        operators.execute_transform_geometry_operation = lambda **_kwargs: (
            self.events.append(("execute",))
        )
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=3,
            run_id="run-1",
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertNotIn("execute", [event[0] for event in self.events])
        self.assertNotIn("prepare", [event[0] for event in self.events])
        self.assertIn("Execute operation 02 next", operator.reports[-1][1])

    def test_operation_01_begins_executes_records_commits_and_focuses_02(self):
        operators, _session, _companion = self._fixture(focused_ordinal=1)
        operators.execute_transform_geometry_operation = lambda **kwargs: (
            self.events.append(("execute", kwargs["operation_ordinal"]))
            or SimpleNamespace(
                before_fingerprint="0" * 64,
                after_fingerprint="1" * 64,
                observation={"details": {}},
                receipt=None,
                transaction="transaction",
            )
        )
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=1,
        )

        result = operator.execute(self.context)

        names = [event[0] for event in self.events]
        self.assertEqual(result, {"FINISHED"})
        self.assertLess(names.index("begin"), names.index("execute"))
        self.assertLess(names.index("execute"), names.index("record"))
        self.assertLess(names.index("record"), names.index("commit"))
        self.assertLess(names.index("commit"), names.index("focus_next"))
        self.assertIn(("prepare", "leaf_operation"), self.events)
        self.assertNotIn(
            "step_succeeded",
            [event[1] for event in self.events if event[0] == "companion"],
        )

    def test_headless_command_returns_strict_bound_progress_result(self):
        operators, session, _companion = self._fixture(focused_ordinal=1)
        result_observation = {"kind": "guided_geometry_operation", "details": {}}
        services = operators.GuidedGeometryCommandServices(
            validate_definition=lambda _arguments: "definition",
            execute_operation=lambda **_kwargs: SimpleNamespace(
                before_fingerprint="0" * 64,
                after_fingerprint="1" * 64,
                observation=result_observation,
                receipt=None,
                transaction="transaction",
            ),
            inverse_operation=lambda **_kwargs: None,
            resume_transaction=lambda **_kwargs: None,
            verify_stage=lambda **_kwargs: True,
            history=operators.GuidedGeometryHistoryPort(
                prepare=lambda operation: self.events.append(("prepare", operation)),
                commit=lambda _session, **_kwargs: self.events.append(("commit",)),
                cancel=lambda: self.events.append(("cancel",)),
                changed=lambda _session: False,
                make_recovery=lambda snapshot, probe: (snapshot, probe),
                requires_native_undo=lambda: False,
                is_native_undo_required_error=lambda _error: False,
            ),
            is_guided_atomicity_error=lambda _error: False,
            is_action_atomicity_error=lambda _error: False,
            is_host_state_restored_error=lambda _error: False,
            observation_gate_error=operators.ObservationGateError,
        )

        result = operators.execute_guided_geometry_operation(
            session=session,
            step=self.step,
            snapshot=session.snapshot,
            step_id="geometry-step",
            operation_id="transform-geometry-01",
            ordinal=1,
            cursor_token="cursor-1",
            run_id="",
            action_name="blender.geometry_nodes.create_transform",
            recipe_id="blender.geometry_nodes.create_transform.semantic",
            services=services,
        )

        self.assertEqual(result.run_id, "run-1")
        self.assertEqual(result.binding_sha256, "b" * 64)
        self.assertEqual(result.operation_id, "transform-geometry-01")
        self.assertEqual((result.ordinal, result.total, result.next_ordinal), (1, 11, 2))
        self.assertEqual(result.completed_operation_ids, ("transform-geometry-01",))
        self.assertEqual(result.observation["details"]["runId"], "run-1")
        self.assertFalse(result.leaf_completed)
        self.assertIsNone(result.report_transition)

    def test_ui_operator_delegates_to_the_same_application_command(self):
        operators, _session, _companion = self._fixture(focused_ordinal=1)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="run-1",
                binding_sha256="b" * 64,
                operation_id="transform-geometry-01",
                ordinal=1,
                total=11,
                next_ordinal=2,
                completed_operation_ids=("transform-geometry-01",),
                observation={"details": {"runId": "run-1"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01 Operation 01",
                focus_next=True,
            )
        )
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=1,
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        self.assertIs(calls[0]["session"], operators._session())
        self.assertIn(("focus_next",), self.events)

    def test_light_trails_ui_dispatches_the_54_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.geometry_nodes",
            ordinal=1,
            label="Geometry Nodes workspace",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="light-trails-step",
            action=SimpleNamespace(
                name="blender.geometry_nodes.create_light_trails",
                arguments={"trailCount": 12},
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.geometry_nodes.create_light_trails.semantic",
            catalog_version="1.55.0",
            cursor_token="light-trails-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="light-run",
                binding_sha256="b" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=54,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "light-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.geometry_nodes.create_light_trails",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.geometry_nodes.create_light_trails.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_light_trails_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_light_trails_operation,
        )

    def test_solidify_ui_dispatches_the_4_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.layout",
            ordinal=1,
            label="Layout",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="solidify-step",
            action=SimpleNamespace(
                name="blender.modifier.add_solidify",
                arguments={
                    "targetId": "mesh-target",
                    "modifierId": "solidify-modifier",
                    "modifierName": "Shell",
                    "thickness": 0.2,
                    "offset": -1.0,
                },
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.modifier.add_solidify.semantic",
            catalog_version="1.59.0",
            cursor_token="solidify-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="solidify-run",
                binding_sha256="b" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=4,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "solidify-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.modifier.add_solidify",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.modifier.add_solidify.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_solidify_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_solidify_operation,
        )

    def test_bevel_modifier_ui_dispatches_the_4_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.layout",
            ordinal=1,
            label="Layout",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="bevel-modifier-step",
            action=SimpleNamespace(
                name="blender.modifier.add_bevel",
                arguments={
                    "targetId": "mesh-target",
                    "modifierId": "bevel-modifier",
                    "modifierName": "Bevel",
                    "width": 0.25,
                    "segments": 3,
                    "angleLimit": 1.0471975511965976,
                },
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.modifier.add_bevel.semantic",
            catalog_version="1.67.0",
            cursor_token="bevel-modifier-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="bevel-modifier-run",
                binding_sha256="b" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=4,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "bevel-modifier-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.modifier.add_bevel",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.modifier.add_bevel.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_bevel_modifier_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_bevel_modifier_operation,
        )

    def test_single_material_ui_dispatches_the_4_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.shading",
            ordinal=1,
            label="Shading",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="single-material-step",
            action=SimpleNamespace(
                name="blender.material.create_and_assign",
                arguments={
                    "materialId": "material.snow",
                    "materialName": "OperatingLine.Snow",
                    "baseColor": [0.82, 0.9, 1.0, 1.0],
                    "roughness": 0.35,
                    "metallic": 0.1,
                    "targets": ["mesh.head", "mesh.body"],
                },
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.material.create_and_assign.semantic",
            catalog_version="1.68.0",
            cursor_token="single-material-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="single-material-run",
                binding_sha256="b" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=4,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "single-material-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.material.create_and_assign",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.material.create_and_assign.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_single_material_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_single_material_operation,
        )

    def test_material_palette_ui_dispatches_the_4_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.shading",
            ordinal=1,
            label="Shading",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="material-palette-step",
            action=SimpleNamespace(
                name="blender.material.create_palette_and_assign",
                arguments={
                    "materials": [
                        {
                            "materialId": "material.snow",
                            "materialName": "OperatingLine.Snow",
                            "baseColor": [0.82, 0.9, 1.0, 1.0],
                            "roughness": 0.35,
                            "metallic": 0.1,
                            "targets": ["mesh.head", "mesh.body"],
                        },
                        {
                            "materialId": "material.coal",
                            "materialName": "OperatingLine.Coal",
                            "baseColor": [0.02, 0.025, 0.03, 1.0],
                            "roughness": 0.6,
                            "metallic": 0.0,
                            "targets": ["mesh.eye.left"],
                        },
                    ]
                },
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.material.create_palette_and_assign.semantic",
            catalog_version="1.69.0",
            cursor_token="material-palette-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="material-palette-run",
                binding_sha256="b" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=4,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "material-palette-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.material.create_palette_and_assign",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.material.create_palette_and_assign.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_material_palette_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_material_palette_operation,
        )

    def test_subdivision_surface_ui_dispatches_the_4_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.layout",
            ordinal=1,
            label="Layout",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="subdivision-surface-step",
            action=SimpleNamespace(
                name="blender.modifier.add_subdivision_surface",
                arguments={
                    "targetId": "mesh-target",
                    "modifierId": "subdivision-surface-modifier",
                    "modifierName": "Subdivision Surface",
                    "viewportLevel": 2,
                },
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.modifier.add_subdivision_surface.semantic",
            catalog_version="1.61.0",
            cursor_token="subdivision-surface-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="subdivision-surface-run",
                binding_sha256="b" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=4,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "subdivision-surface-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.modifier.add_subdivision_surface",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.modifier.add_subdivision_surface.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_subdivision_surface_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_subdivision_surface_operation,
        )

    def test_edit_bevel_ui_dispatches_the_6_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.layout",
            ordinal=1,
            label="Layout",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="edit-bevel-step",
            action=SimpleNamespace(
                name="blender.mesh.edit_bevel_edges",
                arguments={
                    "targetId": "mesh-target",
                    "resultMeshId": "bevel-result-mesh",
                    "resultMeshName": "OperatingLine.BevelResult.Mesh",
                    "width": 0.125,
                    "segments": 3,
                    "profile": 0.6,
                },
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.mesh.edit_bevel_edges.semantic",
            catalog_version="1.63.0",
            cursor_token="edit-bevel-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="edit-bevel-run",
                binding_sha256="b" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=6,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "edit-bevel-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.mesh.edit_bevel_edges",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.mesh.edit_bevel_edges.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_edit_bevel_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_edit_bevel_operation,
        )

    def test_edit_inset_ui_dispatches_the_6_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.layout",
            ordinal=1,
            label="Layout",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="edit-inset-step",
            action=SimpleNamespace(
                name="blender.mesh.edit_inset_faces",
                arguments={
                    "targetId": "mesh-target",
                    "resultMeshId": "inset-result-mesh",
                    "resultMeshName": "OperatingLine.InsetResult.Mesh",
                    "thickness": 0.125,
                    "depth": 0.05,
                },
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.mesh.edit_inset_faces.semantic",
            catalog_version="1.63.0",
            cursor_token="edit-inset-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="edit-inset-run",
                binding_sha256="c" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=6,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "edit-inset-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.mesh.edit_inset_faces",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.mesh.edit_inset_faces.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_edit_inset_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_edit_inset_operation,
        )

    def test_edit_triangulate_ui_dispatches_the_6_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.layout",
            ordinal=1,
            label="Layout",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="edit-triangulate-step",
            action=SimpleNamespace(
                name="blender.mesh.edit_triangulate",
                arguments={
                    "targetId": "mesh-target",
                    "resultMeshId": "triangulate-result-mesh",
                    "resultMeshName": "OperatingLine.TriangulateResult.Mesh",
                },
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.mesh.edit_triangulate.semantic",
            catalog_version="1.66.0",
            cursor_token="edit-triangulate-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="edit-triangulate-run",
                binding_sha256="c" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=6,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "edit-triangulate-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.mesh.edit_triangulate",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.mesh.edit_triangulate.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_edit_triangulate_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_edit_triangulate_operation,
        )

    def test_edit_extrude_region_ui_dispatches_the_6_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.layout",
            ordinal=1,
            label="Layout",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="edit-extrude-region-step",
            action=SimpleNamespace(
                name="blender.mesh.edit_extrude_region",
                arguments={
                    "targetId": "mesh-target",
                    "resultMeshId": "extrude-result-mesh",
                    "resultMeshName": "OperatingLine.ExtrudeResult.Mesh",
                    "polygonIndices": [1],
                    "translation": [0.0, 0.0, 1.0],
                },
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.mesh.edit_extrude_region.semantic",
            catalog_version="1.66.0",
            cursor_token="edit-extrude-region-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="edit-extrude-region-run",
                binding_sha256="c" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=6,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "edit-extrude-region-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.mesh.edit_extrude_region",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.mesh.edit_extrude_region.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_edit_extrude_region_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_edit_extrude_region_operation,
        )

    def test_edit_poke_ui_dispatches_the_6_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.layout",
            ordinal=1,
            label="Layout",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="edit-poke-step",
            action=SimpleNamespace(
                name="blender.mesh.edit_poke_faces",
                arguments={
                    "targetId": "mesh-target",
                    "resultMeshId": "poke-result-mesh",
                    "resultMeshName": "OperatingLine.PokeResult.Mesh",
                    "offset": 0.2,
                },
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.mesh.edit_poke_faces.semantic",
            catalog_version="1.64.0",
            cursor_token="edit-poke-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="edit-poke-run",
                binding_sha256="c" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=6,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "edit-poke-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.mesh.edit_poke_faces",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.mesh.edit_poke_faces.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_edit_poke_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_edit_poke_operation,
        )

    def test_mirror_ui_dispatches_the_7_step_execution_profile(self):
        operation = SimpleNamespace(
            operation_id="workspace.layout",
            ordinal=1,
            label="Layout",
            parameters=(),
            connection=None,
        )
        step = SimpleNamespace(
            id="mirror-step",
            action=SimpleNamespace(
                name="blender.modifier.add_mirror",
                arguments={
                    "targetId": "mesh-target",
                    "modifierId": "mirror-modifier",
                    "modifierName": "Mirror",
                    "axis": "Y",
                },
            ),
        )
        snapshot = SimpleNamespace(
            recipe_id="blender.modifier.add_mirror.semantic",
            catalog_version="1.60.0",
            cursor_token="mirror-cursor",
            focused_ordinal=1,
            focused_operation=operation,
            operations=(operation,),
            can_focus_next=False,
            can_focus_back=False,
        )
        session = _Session(step, snapshot, self.events)
        companion = _Companion(self.events)
        operators = _load_operators(session, companion, self.events)
        command = import_module(
            f"{PACKAGE_NAME}.application.guided_geometry_command"
        )
        calls = []
        operators.execute_guided_geometry_operation = lambda **kwargs: (
            calls.append(kwargs)
            or command.GuidedGeometryCommandResult(
                run_id="mirror-run",
                binding_sha256="b" * 64,
                operation_id=operation.operation_id,
                ordinal=1,
                total=7,
                next_ordinal=2,
                completed_operation_ids=(operation.operation_id,),
                observation={"details": {"runId": "mirror-run"}},
                leaf_completed=False,
                report_transition=None,
                report_message="STATE VERIFIED · operation 01",
                focus_next=False,
            )
        )
        operator = operators.OPERATINGLINE_OT_execute_guided_geometry_operation()
        operator.step_id = step.id
        operator.operation_id = operation.operation_id
        operator.ordinal = 1
        operator.cursor_token = snapshot.cursor_token
        operator.run_id = ""
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append(
            (level, message)
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(len(calls), 1)
        dispatched = calls[0]
        self.assertEqual(
            dispatched["action_name"],
            "blender.modifier.add_mirror",
        )
        self.assertEqual(
            dispatched["recipe_id"],
            "blender.modifier.add_mirror.semantic",
        )
        self.assertIs(
            dispatched["services"].execute_operation,
            operators.execute_mirror_operation,
        )
        self.assertIs(
            dispatched["services"].inverse_operation,
            operators.inverse_mirror_operation,
        )

    def test_operation_11_completes_commits_as_next_and_reports_step_success(self):
        run = _run(completed=10)
        operators, _session, _companion = self._fixture(
            focused_ordinal=11,
            run=run,
        )
        operators.resume_transform_geometry_transaction = (
            lambda **_kwargs: self.events.append(("resume",)) or "transaction"
        )
        operators.execute_transform_geometry_operation = lambda **kwargs: (
            self.events.append(("execute", kwargs["operation_ordinal"]))
            or SimpleNamespace(
                before_fingerprint="a" * 64,
                after_fingerprint="b" * 64,
                observation={"details": {}},
                receipt=SimpleNamespace(id="partial"),
                transaction="transaction",
            )
        )
        command_results = []
        execute_command = operators.execute_guided_geometry_operation

        def capture_command_result(**kwargs):
            result = execute_command(**kwargs)
            command_results.append(result)
            return result

        operators.execute_guided_geometry_operation = capture_command_result
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=11,
            run_id="run-1",
        )

        result = operator.execute(self.context)

        names = [event[0] for event in self.events]
        self.assertEqual(result, {"FINISHED"})
        self.assertIn(("prepare", "next"), self.events)
        self.assertLess(names.index("record"), names.index("complete"))
        self.assertLess(names.index("complete"), names.index("commit"))
        self.assertIn(
            "step_succeeded",
            [event[1] for event in self.events if event[0] == "companion"],
        )
        self.assertNotIn("focus_next", names)
        command_result = command_results[0]
        self.assertTrue(command_result.leaf_completed)
        self.assertEqual(command_result.next_ordinal, 12)
        self.assertEqual(command_result.completed_operation_ids, tuple(
            f"transform-geometry-{ordinal:02d}" for ordinal in range(1, 12)
        ))
        self.assertEqual(command_result.report_transition.name, "step_succeeded")

    def test_operation_02_commit_failure_compensates_and_does_not_finish(self):
        original_run = _run(completed=1)
        operators, session, _companion = self._fixture(
            focused_ordinal=2,
            run=original_run,
        )
        def execute(**kwargs):
            if kwargs["operation_ordinal"] == 1:
                return SimpleNamespace(
                    before_fingerprint=original_run.operation_receipts[-1].before_sha256,
                    after_fingerprint=original_run.operation_receipts[-1].after_sha256,
                    observation={"details": {}},
                    receipt=None,
                    transaction="transaction-after-01",
                )
            return SimpleNamespace(
                before_fingerprint="a" * 64,
                after_fingerprint="b" * 64,
                observation={"details": {}},
                receipt=SimpleNamespace(id="partial-after-02"),
                transaction="transaction-after-02",
            )

        operators.execute_transform_geometry_operation = execute
        operators.inverse_transform_geometry_operation = lambda **kwargs: (
            self.events.append(("inverse", kwargs["operation_ordinal"]))
            or SimpleNamespace(receipt=None)
        )

        def fail_commit(_session, *, rollback, **_kwargs):
            self.events.append(("commit_fault",))
            rollback()
            session.pending_leaf_operation_run = original_run
            raise RuntimeError("injected operation 02 checkpoint failure")

        operators.commit_native_history = fail_commit
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=2,
            run_id="run-1",
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertIs(session.pending_leaf_operation_run, original_run)
        self.assertEqual(
            [event for event in self.events if event[0] == "inverse"],
            [("inverse", 2)],
        )
        self.assertNotIn("focus_next", [event[0] for event in self.events])
        self.assertNotIn(
            "step_succeeded",
            [event[1] for event in self.events if event[0] == "companion"],
        )
        self.assertIn("checkpoint failure", operator.reports[-1][1])

    def test_operation_11_commit_failure_restores_pending_run_without_success(self):
        original_run = _run(completed=10)
        operators, session, _companion = self._fixture(
            focused_ordinal=11,
            run=original_run,
        )
        operators.resume_transform_geometry_transaction = lambda **_kwargs: "transaction"
        operators.execute_transform_geometry_operation = lambda **_kwargs: SimpleNamespace(
            before_fingerprint="a" * 64,
            after_fingerprint="b" * 64,
            observation={"details": {}},
            receipt=SimpleNamespace(id="partial-after-11"),
            transaction="transaction-after-11",
        )
        operators.inverse_transform_geometry_operation = lambda **kwargs: (
            self.events.append(("inverse", kwargs["operation_ordinal"]))
            or SimpleNamespace(receipt=SimpleNamespace(id="partial-before-11"))
        )

        def fail_commit(_session, *, rollback, **_kwargs):
            self.events.append(("commit_fault",))
            rollback()
            session.pending_leaf_operation_run = original_run
            raise RuntimeError("injected operation 11 checkpoint failure")

        operators.commit_native_history = fail_commit
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=11,
            run_id="run-1",
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertIs(session.pending_leaf_operation_run, original_run)
        self.assertEqual(
            [event for event in self.events if event[0] == "inverse"],
            [("inverse", 11)],
        )
        self.assertNotIn(
            "step_succeeded",
            [event[1] for event in self.events if event[0] == "companion"],
        )
        self.assertIn("checkpoint failure", operator.reports[-1][1])

    def test_operation_back_inverts_only_latest_receipt_and_commits_back_history(self):
        run = _run(completed=3)
        operators, _session, _companion = self._fixture(
            focused_ordinal=3,
            run=run,
        )
        operators._guided_geometry_transaction = lambda *_args: "transaction"
        operators.inverse_transform_geometry_operation = lambda **kwargs: (
            self.events.append(("inverse", kwargs["operation_ordinal"]))
            or SimpleNamespace(receipt=SimpleNamespace(id="after-inverse"))
        )
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_undo_guided_geometry_operation",
            ordinal=3,
            run_id="run-1",
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(
            [event for event in self.events if event[0] == "inverse"],
            [("inverse", 3)],
        )
        self.assertEqual(
            [event[2]["ordinal"] for event in self.events if event[0] == "rewind"],
            [3],
        )
        self.assertIn(("prepare", "leaf_operation_back"), self.events)
        self.assertIn(("commit",), self.events)

    def test_operation_back_commit_failure_reapplies_before_cancelling(self):
        original_run = _run(completed=3)
        operators, session, _companion = self._fixture(
            focused_ordinal=3,
            run=original_run,
        )
        operators._guided_geometry_transaction = lambda *_args: "forward-transaction"
        operators.inverse_transform_geometry_operation = lambda **_kwargs: SimpleNamespace(
            receipt=SimpleNamespace(id="after-inverse"),
            transaction="inverse-transaction",
        )
        operators.execute_transform_geometry_operation = lambda **kwargs: (
            self.events.append(("reapply", kwargs["operation_ordinal"]))
            or SimpleNamespace(
                before_fingerprint="a" * 64,
                after_fingerprint="b" * 64,
                observation={"details": {}},
                receipt=SimpleNamespace(id="restored-receipt"),
                transaction="restored-transaction",
            )
        )

        def fail_commit(_session, *, rollback, **_kwargs):
            rollback()
            session.pending_leaf_operation_run = original_run
            raise RuntimeError("injected Back checkpoint failure")

        operators.commit_native_history = fail_commit
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_undo_guided_geometry_operation",
            ordinal=3,
            run_id="run-1",
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertIs(session.pending_leaf_operation_run, original_run)
        self.assertIn(("reapply", 3), self.events)
        self.assertNotIn("focus_previous", [event[0] for event in self.events])

    def test_operation_back_rebuilt_resource_with_wrong_identity_requires_native_undo(self):
        original_run = _run(completed=2)
        operators, _session, _companion = self._fixture(
            focused_ordinal=2,
            run=original_run,
        )
        operators._guided_geometry_transaction = lambda *_args: "forward-transaction"
        operators.inverse_transform_geometry_operation = lambda **_kwargs: SimpleNamespace(
            receipt=None,
            transaction="inverse-transaction",
        )
        operators.execute_transform_geometry_operation = lambda **kwargs: (
            self.events.append(("rebuild_resource", kwargs["operation_ordinal"]))
            or SimpleNamespace(
                before_fingerprint="a" * 64,
                after_fingerprint="b" * 64,
                observation={"details": {}},
                receipt=SimpleNamespace(id="rebuilt-receipt"),
                transaction="rebuilt-with-new-identity",
            )
        )
        operators.verify_transform_geometry_stage = lambda **_kwargs: False
        NativeUndoRequiredError = type(
            "NativeUndoRequiredError", (RuntimeError,), {}
        )
        operators.is_native_undo_required_error = lambda error: isinstance(
            error, NativeUndoRequiredError
        )
        operators.native_history_requires_native_undo = lambda: True

        def fail_commit(_session, *, rollback, recovery_probe, **_kwargs):
            rollback()
            self.assertIs(recovery_probe(), False)
            raise NativeUndoRequiredError("restored resource identity is not exact")

        operators.commit_native_history = fail_commit
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_undo_guided_geometry_operation",
            ordinal=2,
            run_id="run-1",
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(
            [event for event in self.events if event[0] == "rebuild_resource"],
            [("rebuild_resource", 2)],
        )
        self.assertTrue(operator._operating_line_native_undo_required)
        self.assertIn("native Undo is required", operator.reports[-1][1])
        self.assertNotIn("focus_previous", [event[0] for event in self.events])

    def test_abort_rolls_back_pending_run_and_commits_back_history(self):
        operators, session, _companion = self._fixture(
            focused_ordinal=2,
            run=_run(completed=2),
        )
        operator = operators.OPERATINGLINE_OT_abort_guided_geometry_operations()
        operator.step_id = "geometry-step"
        operator.cursor_token = "cursor-1"
        operator.run_id = "run-1"
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append((level, message))

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertIn(("abort", "run-1"), self.events)
        self.assertIsNone(session.pending_leaf_operation_run)
        self.assertIn(("prepare", "leaf_operation_back"), self.events)
        self.assertIn(("commit",), self.events)
        self.assertIn(("reset_guidance",), self.events)

    def test_abort_commit_failure_replays_the_original_prefix(self):
        original_run = _run(completed=3)
        operators, session, _companion = self._fixture(
            focused_ordinal=3,
            run=original_run,
        )
        operators.verify_transform_geometry_stage = lambda **_kwargs: any(
            event[0] == "replay" for event in self.events
        )
        operators.execute_transform_geometry_operation = lambda **kwargs: (
            self.events.append(("replay", kwargs["operation_ordinal"]))
            or SimpleNamespace(
                before_fingerprint="a" * 64,
                after_fingerprint="b" * 64,
                observation={"details": {}},
                receipt=SimpleNamespace(id=f"partial-{kwargs['operation_ordinal']}"),
                transaction=f"transaction-{kwargs['operation_ordinal']}",
            )
        )

        def fail_commit(_session, *, rollback, **_kwargs):
            rollback()
            rollback()
            session.pending_leaf_operation_run = original_run
            raise RuntimeError("injected Abort checkpoint failure")

        operators.commit_native_history = fail_commit
        operator = operators.OPERATINGLINE_OT_abort_guided_geometry_operations()
        operator.step_id = "geometry-step"
        operator.cursor_token = "cursor-1"
        operator.run_id = "run-1"
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append((level, message))

        result = operator.execute(self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertIs(session.pending_leaf_operation_run, original_run)
        self.assertEqual(
            [event for event in self.events if event[0] == "replay"],
            [("replay", 1), ("replay", 2), ("replay", 3)],
        )
        self.assertNotIn(("reset_guidance",), self.events)

    def test_abort_partial_host_failure_is_quarantined_even_when_session_is_unchanged(self):
        original_run = _run(completed=3)
        operators, session, _companion = self._fixture(
            focused_ordinal=3,
            run=original_run,
        )
        operators.verify_transform_geometry_stage = lambda **_kwargs: False
        operators.prepared_native_history_changed = lambda _session: False

        def fail_abort():
            self.events.append(("partial_abort_mutation",))
            raise RuntimeError("injected rollback failure after Blender mutation")

        session.abort_leaf_operation_run = fail_abort
        operators.commit_native_history = lambda _session, **options: self.events.append(
            ("quarantine_commit", options)
        )
        operator = operators.OPERATINGLINE_OT_abort_guided_geometry_operations()
        operator.step_id = "geometry-step"
        operator.cursor_token = "cursor-1"
        operator.run_id = "run-1"
        operator.reports = []
        operator.report = lambda level, message: operator.reports.append((level, message))

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        commits = [event for event in self.events if event[0] == "quarantine_commit"]
        self.assertEqual(len(commits), 1)
        self.assertTrue(commits[0][1]["quarantine"])
        self.assertTrue(callable(commits[0][1]["recovery_probe"]))
        self.assertIs(session.pending_leaf_operation_run, original_run)

    def test_operation_commit_uncertainty_keeps_blender_undo_boundary(self):
        original_run = _run(completed=1)
        operators, _session, _companion = self._fixture(
            focused_ordinal=2,
            run=original_run,
        )
        def execute(**kwargs):
            if kwargs["operation_ordinal"] == 1:
                return SimpleNamespace(
                    before_fingerprint=original_run.operation_receipts[-1].before_sha256,
                    after_fingerprint=original_run.operation_receipts[-1].after_sha256,
                    observation={"details": {}},
                    receipt=None,
                    transaction="transaction-after-01",
                )
            return SimpleNamespace(
                before_fingerprint="a" * 64,
                after_fingerprint="b" * 64,
                observation={"details": {}},
                receipt=SimpleNamespace(id="partial-after-02"),
                transaction="transaction-after-02",
            )

        operators.execute_transform_geometry_operation = execute
        operators.native_history_requires_native_undo = lambda: True
        NativeUndoRequiredError = type(
            "NativeUndoRequiredError", (RuntimeError,), {}
        )
        operators.is_native_undo_required_error = lambda error: isinstance(
            error, NativeUndoRequiredError
        )
        operators.commit_native_history = lambda *_args, **_kwargs: (
            _ for _ in ()
        ).throw(NativeUndoRequiredError("rollback uncertain"))
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=2,
            run_id="run-1",
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertTrue(operator._operating_line_native_undo_required)
        self.assertIn("native Undo is required", operator.reports[-1][1])

    def test_operation_11_gate_rollback_commit_fault_replays_prepared_prefix(self):
        original_run = _run(completed=10)
        operators, session, _companion = self._fixture(
            focused_ordinal=11,
            run=original_run,
        )
        operators.resume_transform_geometry_transaction = lambda **_kwargs: "transaction-10"

        def execute(**kwargs):
            ordinal = kwargs["operation_ordinal"]
            if ordinal != 11:
                self.events.append(("gate_replay", ordinal))
            return SimpleNamespace(
                before_fingerprint="a" * 64,
                after_fingerprint="b" * 64,
                observation={"details": {}},
                receipt=SimpleNamespace(id=f"partial-{ordinal}"),
                transaction=f"transaction-{ordinal}",
            )

        operators.execute_transform_geometry_operation = execute
        operators.verify_transform_geometry_stage = lambda **_kwargs: len(
            [event for event in self.events if event[0] == "gate_replay"]
        ) == 10
        operators.prepared_native_history_changed = lambda _session: True
        gate = SimpleNamespace(
            status="failed_rolled_back",
            message="success gate failed and rolled back",
            observation_copy=lambda: [{"satisfied": False}],
        )

        def fail_gate(_step, *, run_id):
            self.events.append(("gate_rollback", run_id))
            session.pending_leaf_operation_run = None
            raise operators.ObservationGateError(self.step, gate)

        session.complete_leaf_operation_run = fail_gate

        def fail_commit(_session, *, rollback, **_kwargs):
            rollback()
            session.pending_leaf_operation_run = original_run
            raise RuntimeError("injected gate checkpoint failure")

        operators.commit_native_history = fail_commit
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=11,
            run_id="run-1",
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertEqual(
            [event[1] for event in self.events if event[0] == "gate_replay"],
            list(range(1, 11)),
        )
        self.assertIs(session.pending_leaf_operation_run, original_run)

    def test_operation_11_gate_rollback_failure_is_quarantined(self):
        original_run = _run(completed=10)
        operators, session, _companion = self._fixture(
            focused_ordinal=11,
            run=original_run,
        )
        operators.resume_transform_geometry_transaction = lambda **_kwargs: "transaction-10"
        operators.execute_transform_geometry_operation = lambda **_kwargs: SimpleNamespace(
            before_fingerprint="a" * 64,
            after_fingerprint="b" * 64,
            observation={"details": {}},
            receipt=SimpleNamespace(id="partial-11"),
            transaction="transaction-11",
        )
        operators.prepared_native_history_changed = lambda _session: False
        gate = SimpleNamespace(
            status="rollback_failed",
            message="success gate failed and rollback became partial",
            observation_copy=lambda: [{"satisfied": False}],
        )

        def fail_gate(_step, *, run_id):
            self.events.append(("partial_gate_rollback", run_id))
            session.pending_leaf_operation_run = None
            raise operators.ObservationGateError(self.step, gate)

        session.complete_leaf_operation_run = fail_gate
        operators.commit_native_history = lambda _session, **options: self.events.append(
            ("quarantine_commit", options)
        )
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_operation",
            ordinal=11,
            run_id="run-1",
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        commits = [event for event in self.events if event[0] == "quarantine_commit"]
        self.assertEqual(len(commits), 1)
        self.assertTrue(commits[0][1]["quarantine"])
        self.assertTrue(callable(commits[0][1]["recovery_probe"]))
        self.assertIn("native Undo is required", operator.reports[-1][1])
        self.assertNotIn(
            "step_succeeded",
            [event[1] for event in self.events if event[0] == "companion"],
        )

    def test_atomic_next_gate_rollback_failure_is_quarantined(self):
        operators, session, _companion = self._fixture(focused_ordinal=1)
        session.active_step = self.step
        gate = SimpleNamespace(
            status="rollback_failed",
            blocking=True,
            message="atomic action rollback became partial",
            observation_copy=lambda: [{"satisfied": False}],
        )

        def fail_next(_attempt):
            raise operators.ObservationGateError(self.step, gate)

        session.next = fail_next
        operators.prepared_native_history_changed = lambda _session: False
        operators.commit_native_history = lambda _session, **options: self.events.append(
            ("atomic_quarantine_commit", options)
        )
        operator = SimpleNamespace(
            reports=[],
            report=lambda level, message: operator.reports.append((level, message)),
        )

        result = operators._execute_next(operator, self.context)

        self.assertEqual(result, {"FINISHED"})
        commits = [
            event for event in self.events if event[0] == "atomic_quarantine_commit"
        ]
        self.assertEqual(len(commits), 1)
        self.assertTrue(commits[0][1]["quarantine"])
        self.assertIn("native Undo is required", operator.reports[-1][1])

    def test_candidate_menu_leaf_cannot_enter_managed_next_or_native_history(self):
        operators, session, _companion = self._fixture(focused_ordinal=1)
        self.step.candidate_menu_projection = SimpleNamespace()
        next_calls = []
        session.next = lambda _attempt: next_calls.append("next")
        history_calls = []
        operators._prepare_history = lambda *_args: history_calls.append("prepare") or True
        operator = SimpleNamespace(
            reports=[],
            report=lambda level, message: operator.reports.append((level, message)),
        )

        result = operators._execute_next(operator, self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertEqual(history_calls, [])
        self.assertEqual(next_calls, [])
        self.assertIn("candidate-only menu path", operator.reports[-1][1])
        self.assertIn(
            ("companion", "error", self.step, "candidate_menu_execution_forbidden"),
            self.events,
        )

    def test_repair_required_marker_fault_keeps_native_undo_boundary_locked(self):
        operators, session, _companion = self._fixture(focused_ordinal=1)
        session.active_step = self.step
        gate = SimpleNamespace(
            status="repair_required",
            blocking=True,
            message="repair the partially retained action",
            observation_copy=lambda: [{"satisfied": False}],
        )
        session.next = lambda _attempt: (_ for _ in ()).throw(
            operators.ObservationGateError(self.step, gate)
        )
        operators.prepared_native_history_changed = lambda _session: True
        NativeUndoRequiredError = type(
            "NativeUndoRequiredError", (RuntimeError,), {}
        )
        operators.is_native_undo_required_error = lambda error: isinstance(
            error, NativeUndoRequiredError
        )
        operators.native_history_requires_native_undo = lambda: True
        operators.commit_native_history = lambda _session, **_options: (
            _ for _ in ()
        ).throw(NativeUndoRequiredError("marker fault requires native Undo"))
        operator = SimpleNamespace(
            reports=[],
            report=lambda level, message: operator.reports.append((level, message)),
        )

        result = operators._execute_next(operator, self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertTrue(operator._operating_line_native_undo_required)
        self.assertIn(
            "marker fault requires native Undo",
            [message for _level, message in operator.reports],
        )
        self.assertNotIn(("cancel",), self.events)

    def test_ordinary_next_failure_without_host_proof_is_quarantined(self):
        operators, session, _companion = self._fixture(focused_ordinal=1)
        session.active_step = self.step
        session.next = lambda _attempt: (_ for _ in ()).throw(
            RuntimeError("action rollback proof unavailable")
        )
        operators.prepared_native_history_changed = lambda _session: False
        operators.commit_native_history = lambda _session, **options: self.events.append(
            ("ordinary_quarantine_commit", options)
        )
        operator = SimpleNamespace(
            reports=[],
            report=lambda level, message: operator.reports.append((level, message)),
        )

        result = operators._execute_next(operator, self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(
            [
                event
                for event in self.events
                if event[0] == "ordinary_quarantine_commit"
            ],
            [("ordinary_quarantine_commit", {"quarantine": True})],
        )
        self.assertIn("native Undo is required", operator.reports[-1][1])

    def test_action_restored_error_cancels_without_native_undo_quarantine(self):
        operators, session, _companion = self._fixture(focused_ordinal=1)
        session.active_step = self.step
        ActionHostStateRestoredError = type(
            "ActionHostStateRestoredError", (RuntimeError,), {}
        )
        operators.is_action_host_state_restored_error = lambda error: isinstance(
            error, ActionHostStateRestoredError
        )
        session.next = lambda _attempt: (_ for _ in ()).throw(
            ActionHostStateRestoredError("name conflict before mutation")
        )
        operators.prepared_native_history_changed = lambda _session: False
        operator = SimpleNamespace(
            reports=[],
            report=lambda level, message: operator.reports.append((level, message)),
        )

        result = operators._execute_next(operator, self.context)

        self.assertEqual(result, {"CANCELLED"})
        self.assertIn(("cancel",), self.events)
        self.assertNotIn(("commit",), self.events)
        self.assertNotIn(
            "native Undo is required",
            [message for _level, message in operator.reports],
        )

    def test_action_atomicity_error_is_quarantined_for_native_undo(self):
        operators, session, _companion = self._fixture(focused_ordinal=1)
        ActionAtomicityError = type("ActionAtomicityError", (RuntimeError,), {})
        operators.is_action_atomicity_error = lambda error: isinstance(
            error, ActionAtomicityError
        )
        operators.prepared_native_history_changed = lambda _session: False
        operators.commit_native_history = lambda _session, **options: self.events.append(
            ("action_atomicity_quarantine", options)
        )
        operator = SimpleNamespace(
            reports=[],
            report=lambda level, message: operator.reports.append((level, message)),
        )

        result = operators._finish_failed_operation(
            operator,
            session,
            self.step,
            ActionAtomicityError("partial action rollback failed"),
        )

        self.assertEqual(result, {"FINISHED"})
        self.assertIn(
            ("action_atomicity_quarantine", {"quarantine": True}),
            self.events,
        )
        self.assertIn("native Undo is required", operator.reports[-1][1])

    def test_unrecoverable_host_mutation_is_quarantined_for_native_undo(self):
        operators, session, _companion = self._fixture(focused_ordinal=1)

        class AtomicFailure(RuntimeError):
            pass

        failure = AtomicFailure("injected unprovable Blender mutation")
        operators.is_guided_geometry_atomicity_error = (
            lambda error: isinstance(error, AtomicFailure)
        )
        operators.prepared_native_history_changed = lambda _session: False

        def commit_quarantine(_session, **options):
            self.events.append(("quarantine_commit", options))

        operators.commit_native_history = commit_quarantine
        operator = SimpleNamespace(report=lambda *_args: None)

        result = operators._finish_failed_operation(
            operator,
            session,
            self.step,
            failure,
        )

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(
            [event for event in self.events if event[0] == "quarantine_commit"],
            [("quarantine_commit", {"quarantine": True})],
        )
        self.assertNotIn(("cancel",), self.events)

    def test_direct_atomic_leaf_invocation_with_pending_run_fails_closed(self):
        operators, session, _companion = self._fixture(
            focused_ordinal=9,
            run=_run(completed=8),
        )
        session.next = lambda _attempt: (
            self.events.append(("session_next",))
            or (_ for _ in ()).throw(
                ValueError("Finish or abort leaf operations before atomic Next")
            )
        )
        operators.commit_native_history = lambda _session, **options: self.events.append(
            ("pending_run_quarantine", options)
        )
        operator = _operator(
            operators,
            "OPERATINGLINE_OT_execute_guided_geometry_leaf",
            ordinal=9,
            run_id="run-1",
        )

        result = operator.execute(self.context)

        self.assertEqual(result, {"FINISHED"})
        self.assertIn(("session_next",), self.events)
        self.assertIn(("prepare", "next"), self.events)
        self.assertIn(
            ("pending_run_quarantine", {"quarantine": True}),
            self.events,
        )
        self.assertNotIn(("cancel",), self.events)
        self.assertIn("native Undo is required", operator.reports[-1][1])


if __name__ == "__main__":
    unittest.main()
