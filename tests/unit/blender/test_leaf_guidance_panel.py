"""Behavior coverage for leaf-local operations in the Blender sidebar."""

from importlib import import_module
import ast
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_leaf_guidance_panel_test"


class _Layout:
    def __init__(
        self,
        labels: list[str] | None = None,
        operator_states: list[tuple[str, str | None, bool]] | None = None,
    ) -> None:
        self.enabled = True
        self.alert = False
        self.scale_y = 1.0
        self.labels = labels if labels is not None else []
        self.operator_states = operator_states if operator_states is not None else []

    def _child(self):
        return _Layout(self.labels, self.operator_states)

    def box(self):
        return self._child()

    def row(self, **_kwargs):
        return self._child()

    def column(self, **_kwargs):
        return self._child()

    def split(self, **_kwargs):
        return self._child()

    def grid_flow(self, **_kwargs):
        return self._child()

    def label(self, *, text: str, **_kwargs) -> None:
        self.labels.append(text)

    def operator(self, *args, **kwargs):
        text = kwargs.get("text")
        self.operator_states.append((args[0] if args else "", text, self.enabled))
        if text:
            self.labels.append(text)
        return SimpleNamespace()

    def prop(self, *_args, **_kwargs) -> None:
        return None

    def popover(self, *, panel: str, **_kwargs) -> None:
        self.labels.append(f"popover:{panel}")

    def separator(self, **_kwargs) -> None:
        return None


class _Companion:
    connected = True
    status = "Connected"
    error = ""
    proposed_plan = None
    goal_entry_blocked = True
    goal_request = SimpleNamespace(active=False)
    execution_track_preflight_message = ""
    execution_track_preflight_request = None

    @staticmethod
    def has_revision_reference(_scope: str, _node_id: str) -> bool:
        return False


class _Session:
    def __init__(self, leaf) -> None:
        self.root = leaf
        self.steps = (leaf,)
        self.active_step = None
        self.active_index = -1
        self.completed_steps = ()
        self.started = True
        self.observation_blocked = False
        self.observation_gate = None

    @property
    def guidance_step(self):
        gate = self.observation_gate
        if gate is not None and gate.blocking:
            return next(step for step in self.steps if step.id == gate.step_id)
        next_index = self.active_index + 1
        if 0 <= next_index < len(self.steps):
            return self.steps[next_index]
        if 0 <= self.active_index < len(self.steps):
            return self.steps[self.active_index]
        return None

    @staticmethod
    def is_expanded(_node_id: str) -> bool:
        return True


def _operation(
    ordinal: int,
    label: str,
    *,
    native: bool,
    display_value: str | None = None,
    connection=None,
):
    parameters = ()
    if display_value is not None:
        parameters = (
            SimpleNamespace(
                name="value",
                value=display_value,
                display_value=display_value,
                resolved=True,
                reason=None,
            ),
        )
    return SimpleNamespace(
        ordinal=ordinal,
        ordinal_label=f"{ordinal:02d}",
        operation_id=f"operation-{ordinal}",
        label=label,
        intent="adjust" if not native else "navigate",
        target_kind="control" if not native else "menu",
        target_id=f"target-{ordinal}",
        path=(label,),
        parameters=parameters,
        role=SimpleNamespace(value="locked" if not native else "next"),
        state="locked" if not native else "next",
        native=native,
        reference=not native,
        evidence=SimpleNamespace(value="none"),
        connection=connection,
    )


def _snapshot(
    *,
    focused_ordinal: int = 1,
    retry_serial: int = 0,
    step_id: str = "snowman.model.body_lower",
):
    operations = (
        _operation(1, "Layout", native=True),
        _operation(2, "Add", native=True),
        _operation(3, "Mesh", native=True),
        _operation(4, "UV Sphere", native=True),
        _operation(5, "Location", native=False, display_value="[0, 0, -1.5]"),
        _operation(6, "Scale", native=False, display_value="[1.75, 1.75, 1.75]"),
        _operation(
            7,
            "Object Name",
            native=False,
            display_value='"OperatingLine.Snowman.BodyLower"',
        ),
    )
    return SimpleNamespace(
        step_id=step_id,
        title="Create the lower body",
        native=True,
        operations=operations,
        focused_ordinal=focused_ordinal,
        focused_operation=operations[focused_ordinal - 1],
        cursor_token="current-leaf-cursor-token",
        retry_serial=retry_serial,
        can_focus_back=focused_ordinal > 1,
        can_focus_next=focused_ordinal < len(operations),
        candidate_only=False,
        reason=None,
    )


def _load_panel(session: _Session, companion: _Companion):
    class _OutlinerHeader:
        callbacks = []

        @classmethod
        def append(cls, callback) -> None:
            cls.callbacks.append(callback)

        @classmethod
        def remove(cls, callback) -> None:
            cls.callbacks.remove(callback)

    fake_bpy = ModuleType("bpy")
    fake_bpy.types = SimpleNamespace(
        Panel=object,
        OUTLINER_HT_header=_OutlinerHeader,
    )
    fake_bpy.app = SimpleNamespace(online_access=True)
    sys.modules["bpy"] = fake_bpy

    package = ModuleType(PACKAGE_NAME)
    package.__path__ = [str(PACKAGE_ROOT)]
    package.get_session = lambda: session
    package.get_companion = lambda: companion
    sys.modules[PACKAGE_NAME] = package

    application = ModuleType(f"{PACKAGE_NAME}.application")
    application.GuidanceState = SimpleNamespace(BACK="back", NEXT="next")
    application.MenuGuidanceTracker = type(
        "MenuGuidanceTracker",
        (),
        {"snapshot": lambda _self, _step: _snapshot()},
    )
    application.node_state = lambda *_args: "next"
    sys.modules[application.__name__] = application

    infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
    infrastructure.native_history_error = lambda: ""
    sys.modules[infrastructure.__name__] = infrastructure

    visual_theme = ModuleType(f"{PACKAGE_NAME}.visual_theme")
    visual_theme.STATE_ICONS = {
        "back": "BACK",
        "next": "NEXT",
        "locked": "LOCKED",
    }
    visual_theme.STATE_SYMBOLS = {"next": ">"}
    sys.modules[visual_theme.__name__] = visual_theme

    presentation = ModuleType(f"{PACKAGE_NAME}.presentation")
    presentation.__path__ = [str(PACKAGE_ROOT / "presentation")]
    sys.modules[presentation.__name__] = presentation

    revision_workspace = ModuleType(f"{PACKAGE_NAME}.presentation.revision_workspace")
    revision_workspace.draw_revision_workspace = lambda *_args, **_kwargs: None
    revision_workspace.draw_wrapped_text = lambda layout, text, **_kwargs: layout.label(
        text=text
    )
    sys.modules[revision_workspace.__name__] = revision_workspace

    native_guidance = ModuleType(
        f"{PACKAGE_NAME}.presentation.native_menu_guidance"
    )
    native_guidance.interaction_guidance_snapshot = lambda: _snapshot()
    native_guidance.leaf_guidance_snapshot = (
        lambda step: _snapshot(step_id=step.id) if step is not None else None
    )
    sys.modules[native_guidance.__name__] = native_guidance

    module_name = f"{PACKAGE_NAME}.presentation.panel"
    sys.modules.pop(module_name, None)
    return import_module(module_name)


def _context(*, guidance_visible: bool):
    return SimpleNamespace(
        window_manager=SimpleNamespace(
            operating_line_overlay_enabled=guidance_visible,
            operating_line_runtime_url="ws://127.0.0.1",
            operating_line_bearer_token="",
        ),
        scene=SimpleNamespace(operating_line_replace_factory_scene=False),
    )


class LeafGuidancePanelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.leaf = SimpleNamespace(
            id="snowman.model.body_lower",
            number="1.2.1",
            title="Create the lower body",
            children=(),
            execution_track_override=None,
        )
        self.session = _Session(self.leaf)
        self.companion = _Companion()
        self.panel = _load_panel(self.session, self.companion)

    def _draw(self, *, guidance_visible: bool) -> list[str]:
        layout = _Layout()
        instance = self.panel.OPERATINGLINE_PT_sidebar()
        instance.layout = layout
        instance.draw(_context(guidance_visible=guidance_visible))
        return layout.labels

    def test_reference_copy_distinguishes_guided_and_container_targets(self) -> None:
        guided = SimpleNamespace(
            target_trust="guided_control",
            target_kind="socket",
            container_target_id="GeometryNodeTransform",
            connection=None,
        )
        container = SimpleNamespace(
            target_trust="container_capable",
            target_kind="node",
            container_target_id=None,
            connection=None,
        )

        self.assertEqual(
            self.panel._operation_reference_text(guided),
            "GUIDED CONTROL · OperatingLine-owned proxy edits the same Blender data",
        )
        self.assertEqual(
            self.panel._operation_reference_text(container),
            "CONTAINER CAPABLE · resolves only from the current receipt and visible node frame",
        )

    def test_draws_every_leaf_operation_with_a_two_digit_local_ordinal(self) -> None:
        labels = self._draw(guidance_visible=True)

        expected = (
            ("01", "Layout"),
            ("02", "Add"),
            ("03", "Mesh"),
            ("04", "UV Sphere"),
            ("05", "Location"),
            ("06", "Scale"),
            ("07", "Object Name"),
        )
        for ordinal, operation_label in expected:
            with self.subTest(ordinal=ordinal):
                self.assertTrue(
                    any(ordinal in text and operation_label in text for text in labels),
                    labels,
                )

    def test_draws_leaf_local_instruction_navigation_separate_from_execution(self) -> None:
        labels = self._draw(guidance_visible=True)
        rendered = "\n".join(labels)

        self.assertIn("Instruction 01 / 07", rendered)
        self.assertIn("-- Back", labels)
        self.assertIn("Retry 01", labels)
        self.assertIn("02 Next", labels)
        self.assertIn("Instruction controls only", rendered)
        self.assertIn("global Execute and Back", rendered)

    def test_retry_feedback_keeps_the_same_leaf_ordinal_visible(self) -> None:
        native_guidance = sys.modules[
            f"{PACKAGE_NAME}.presentation.native_menu_guidance"
        ]
        native_guidance.interaction_guidance_snapshot = lambda: _snapshot(
            focused_ordinal=3,
            retry_serial=2,
        )
        labels = self._draw(guidance_visible=True)
        rendered = "\n".join(labels)

        self.assertIn("Instruction 03 / 07", rendered)
        self.assertIn("Retry request 02 re-highlighted instruction 03", rendered)

    def test_draws_resolved_parameter_values_and_marks_reference_operations(self) -> None:
        labels = self._draw(guidance_visible=True)
        rendered = "\n".join(labels)

        self.assertIn("[0, 0, -1.5]", rendered)
        self.assertIn("[1.75, 1.75, 1.75]", rendered)
        self.assertIn('"OperatingLine.Snowman.BodyLower"', rendered)
        self.assertIn("REFERENCE ONLY", rendered)

    def test_candidate_leaf_displays_non_equivalence_and_all_values(self) -> None:
        operations = tuple(
            _operation(
                ordinal,
                f"Candidate operation {ordinal}",
                native=ordinal in {4, 5, 6, 7},
                display_value=(
                    "3" if ordinal == 9 else "0.25" if ordinal == 10 else None
                ),
            )
            for ordinal in range(1, 12)
        )
        snapshot = SimpleNamespace(
            step_id=self.leaf.id,
            title="Native Subdivide candidate",
            native=False,
            candidate_only=True,
            reason="The native UI mutates the active mesh in place.",
            operations=operations,
            focused_ordinal=1,
            focused_operation=operations[0],
            cursor_token="candidate-cursor",
            retry_serial=0,
            can_focus_back=False,
            can_focus_next=True,
        )
        native_guidance = sys.modules[
            f"{PACKAGE_NAME}.presentation.native_menu_guidance"
        ]
        native_guidance.interaction_guidance_snapshot = lambda: snapshot

        rendered = "\n".join(self._draw(guidance_visible=True))

        self.assertIn("CANDIDATE ONLY", rendered)
        self.assertIn("Native in-place operation", rendered)
        self.assertIn("No managed receipt", rendered)
        self.assertIn("no managed replacement mesh", rendered)
        self.assertIn("Instruction 01 / 11", rendered)
        self.assertIn("Candidate operation 11", rendered)
        self.assertIn("3", rendered)
        self.assertIn("0.25", rendered)

    def test_candidate_leaf_disables_global_managed_next(self) -> None:
        self.leaf.candidate_menu_projection = SimpleNamespace()
        layout = _Layout()

        self.panel._draw_walkthrough_controls(
            layout,
            self.session,
            _Companion(),
            proposal_pending=False,
            history_error="",
        )

        next_states = [
            enabled
            for operator_id, _text, enabled in layout.operator_states
            if operator_id == "operating_line.next"
        ]
        self.assertEqual(next_states, [False])

    def test_hidden_markers_keep_the_current_leaf_and_active_tree_visible(self) -> None:
        labels = self._draw(guidance_visible=False)
        rendered = "\n".join(labels)

        self.assertIn("Current leaf", rendered)
        self.assertIn("01", rendered)
        self.assertIn("07", rendered)
        self.assertIn("Active task tree", labels)
        self.assertIn("1.2.1", rendered)
        self.assertIn("Create the lower body", rendered)

    def test_blocking_gate_draws_the_failed_leaf_instead_of_the_following_leaf(
        self,
    ) -> None:
        following_leaf = SimpleNamespace(
            id="snowman.model.following",
            number="1.2.2",
            title="Following leaf",
            children=(),
            execution_track_override=None,
        )
        self.session.steps = (self.leaf, following_leaf)
        self.session.active_index = 0
        self.session.observation_blocked = True
        self.session.observation_gate = SimpleNamespace(
            step_id=self.leaf.id,
            blocking=True,
            status="repair_required",
            message="repair failed leaf",
        )
        layout = _Layout()

        snapshot = self.panel._leaf_guidance_snapshot(
            self.session,
            markers_visible=False,
        )
        self.panel._draw_leaf_operations(layout, self.session, snapshot)

        rendered = "\n".join(layout.labels)
        self.assertIn("Create the lower body", rendered)
        self.assertNotIn("Following leaf", rendered)
        self.assertEqual(snapshot.step_id, self.leaf.id)

    def test_registers_tree_docks_for_node_uv_and_animation_editors(self) -> None:
        expected_spaces = {
            "NODE_EDITOR",
            "IMAGE_EDITOR",
            "DOPESHEET_EDITOR",
            "GRAPH_EDITOR",
            "NLA_EDITOR",
            "SEQUENCE_EDITOR",
        }

        self.assertEqual(
            {
                panel_type.bl_space_type
                for panel_type in self.panel.CLASSES
                if getattr(panel_type, "bl_region_type", None) == "UI"
                and panel_type is not self.panel.OPERATINGLINE_PT_sidebar
            },
            expected_spaces,
        )

    def test_registers_properties_window_panels_for_major_contexts(self) -> None:
        properties_panels = {
            panel_type.bl_context: panel_type
            for panel_type in self.panel.CLASSES
            if getattr(panel_type, "bl_space_type", None) == "PROPERTIES"
        }

        self.assertEqual(
            set(properties_panels),
            {
                "object",
                "modifier",
                "data",
                "material",
                "render",
                "output",
                "world",
                "scene",
                "constraint",
            },
        )
        self.assertTrue(
            all(
                panel_type.bl_region_type == "WINDOW"
                for panel_type in properties_panels.values()
            )
        )

    def test_properties_panel_draws_the_same_leaf_operations_and_tree(self) -> None:
        layout = _Layout()
        instance = self.panel.OPERATINGLINE_PT_properties_modifier_guidance()
        instance.layout = layout

        instance.draw(_context(guidance_visible=True))

        rendered = "\n".join(layout.labels)
        self.assertIn("Tree and leaf operations", rendered)
        self.assertIn("Instruction 01 / 07", rendered)
        self.assertIn("01  Layout", rendered)
        self.assertIn("07  Object Name", rendered)
        self.assertIn("Active task tree", layout.labels)

    def test_outliner_header_popover_registration_is_idempotent_and_reversible(
        self,
    ) -> None:
        header = sys.modules["bpy"].types.OUTLINER_HT_header

        self.panel.register_outliner_header_entry()
        self.panel.register_outliner_header_entry()

        self.assertEqual(header.callbacks, [self.panel._draw_outliner_header_entry])
        layout = _Layout()
        header.callbacks[0](SimpleNamespace(layout=layout), object())
        self.assertEqual(
            layout.labels,
            ["popover:OPERATINGLINE_PT_outliner_guidance_popover"],
        )

        self.panel.unregister_outliner_header_entry()
        self.panel.unregister_outliner_header_entry()
        self.assertEqual(header.callbacks, [])

    def test_outliner_header_remove_failure_keeps_registration_fail_closed(
        self,
    ) -> None:
        header = sys.modules["bpy"].types.OUTLINER_HT_header
        original_remove = header.__dict__["remove"]

        for error_type in (RuntimeError, ValueError):
            with self.subTest(error_type=error_type.__name__):
                self.panel.register_outliner_header_entry()

                def fail_remove(_header, _callback, *, _error=error_type):
                    raise _error("simulated Blender header removal failure")

                header.remove = classmethod(fail_remove)
                with self.assertRaisesRegex(error_type, "simulated Blender"):
                    self.panel.unregister_outliner_header_entry()

                self.assertTrue(self.panel._outliner_header_entry_registered)
                self.panel.register_outliner_header_entry()
                self.assertEqual(
                    header.callbacks,
                    [self.panel._draw_outliner_header_entry],
                )

                header.remove = original_remove
                self.panel.unregister_outliner_header_entry()
                self.assertFalse(self.panel._outliner_header_entry_registered)
                self.assertEqual(header.callbacks, [])

    def test_extension_unregister_removes_outliner_before_any_other_teardown(self) -> None:
        module = ast.parse((PACKAGE_ROOT / "__init__.py").read_text(encoding="utf-8"))
        unregister = next(
            node
            for node in module.body
            if isinstance(node, ast.FunctionDef) and node.name == "unregister"
        )
        first_effect = next(
            statement
            for statement in unregister.body
            if not isinstance(statement, ast.Global)
        )

        self.assertIsInstance(first_effect, ast.Expr)
        call = first_effect.value
        self.assertIsInstance(call, ast.Call)
        self.assertIsInstance(call.func, ast.Name)
        self.assertEqual(call.func.id, "unregister_outliner_header_entry")

    def test_outliner_popover_draws_the_same_leaf_operations_and_tree(self) -> None:
        layout = _Layout()
        instance = self.panel.OPERATINGLINE_PT_outliner_guidance_popover()
        instance.layout = layout

        instance.draw(_context(guidance_visible=True))

        rendered = "\n".join(layout.labels)
        self.assertIn("Outliner guidance opens from this header popover", rendered)
        self.assertIn("Instruction 01 / 07", rendered)
        self.assertIn("01  Layout", rendered)
        self.assertIn("07  Object Name", rendered)
        self.assertIn("Active task tree", layout.labels)

    def test_node_editor_dock_draws_the_same_leaf_operations_and_tree(self) -> None:
        layout = _Layout()
        instance = self.panel.OPERATINGLINE_PT_node_editor_guidance()
        instance.layout = layout

        instance.draw(_context(guidance_visible=True))

        rendered = "\n".join(layout.labels)
        self.assertIn("Tree and leaf operations", rendered)
        self.assertIn("Markers require a verified target resolver", rendered)
        self.assertIn("01", rendered)
        self.assertIn("07", rendered)
        self.assertIn("Active task tree", layout.labels)

    def test_tree_renders_node_creation_socket_values_and_connections_in_order(self) -> None:
        operations = (
            _operation(1, "Add Transform Geometry", native=False),
            _operation(
                2,
                "Set Translation",
                native=False,
                display_value="[1, 2, 3]",
            ),
            _operation(
                3,
                "Connect Group Input.Geometry -> Transform.Geometry",
                native=False,
                connection=SimpleNamespace(
                    from_node="NodeGroupInput",
                    from_socket="Geometry",
                    to_node="GeometryNodeTransform",
                    to_socket="Geometry",
                ),
            ),
        )
        snapshot = SimpleNamespace(
            step_id=self.leaf.id,
            operations=operations,
        )
        layout = _Layout()

        self.panel._draw_node(
            layout,
            self.leaf,
            self.session,
            self.companion,
            leaf_snapshot=snapshot,
        )

        rendered = "\n".join(layout.labels)
        self.assertIn("01  Add Transform Geometry", rendered)
        self.assertIn("02  Set Translation", rendered)
        self.assertIn("[1, 2, 3]", rendered)
        self.assertIn(
            "03  Connect Group Input.Geometry -> Transform.Geometry",
            rendered,
        )
        self.assertIn(
            "NodeGroupInput.Geometry → GeometryNodeTransform.Geometry",
            rendered,
        )


if __name__ == "__main__":
    unittest.main()
