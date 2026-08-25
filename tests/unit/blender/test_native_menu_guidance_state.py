"""Regression coverage for native-menu guidance visibility state."""

from importlib import import_module
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_native_menu_guidance_state_test"


def _stock_draw(*_args, **_kwargs) -> None:
    return None


class _MenuType:
    draw = _stock_draw


class _AddMenuType:
    draw = _stock_draw
    bl_label = "Add"


class _Layout:
    def __init__(self) -> None:
        self.calls = []
        self.alert = False

    def row(self, **_kwargs):
        return self

    def separator(self, **_kwargs) -> None:
        self.calls.append(("separator", {}))

    def operator(self, operator_id, **kwargs):
        properties = SimpleNamespace()
        self.calls.append(("operator", operator_id, kwargs, properties))
        return properties

    def menu(self, menu_id, **kwargs) -> None:
        self.calls.append(("menu", menu_id, kwargs))


def _load_modules():
    fake_bpy = ModuleType("bpy")
    fake_bpy.app = SimpleNamespace(
        version=(4, 5, 3),
        translations=SimpleNamespace(pgettext_iface=lambda value: value),
    )
    fake_bpy.types = SimpleNamespace(
        VIEW3D_MT_editor_menus=type("EditorMenus", (_MenuType,), {}),
        VIEW3D_MT_add=type("AddMenu", (_AddMenuType,), {}),
        VIEW3D_MT_mesh_add=type("MeshMenu", (_MenuType,), {}),
        VIEW3D_MT_select_edit_mesh=type("SelectEditMesh", (_MenuType,), {}),
        VIEW3D_MT_edit_mesh_edges=type("EditMeshEdges", (_MenuType,), {}),
    )
    sys.modules["bpy"] = fake_bpy

    translations = ModuleType("bpy.app.translations")
    translations.contexts = SimpleNamespace(id_id="ID")
    sys.modules["bpy.app"] = fake_bpy.app
    sys.modules["bpy.app.translations"] = translations

    package = ModuleType(PACKAGE_NAME)
    package.__path__ = [str(PACKAGE_ROOT)]
    sys.modules[PACKAGE_NAME] = package

    application = import_module(f"{PACKAGE_NAME}.application")
    domain = import_module(f"{PACKAGE_NAME}.domain")

    presentation = ModuleType(f"{PACKAGE_NAME}.presentation")
    presentation.__path__ = [str(PACKAGE_ROOT / "presentation")]
    sys.modules[presentation.__name__] = presentation

    visual_theme = ModuleType(f"{PACKAGE_NAME}.visual_theme")
    visual_theme.STATE_ICONS = {
        "back": "BACK",
        "completed": "CHECKMARK",
        "locked": "LOCKED",
        "next": "NEXT",
    }
    sys.modules[visual_theme.__name__] = visual_theme

    module_name = f"{PACKAGE_NAME}.presentation.native_menu_guidance"
    sys.modules.pop(module_name, None)
    native_guidance = import_module(module_name)
    return application, domain, native_guidance


application, domain, native_guidance = _load_modules()


def _load_operators():
    bpy = sys.modules["bpy"]
    bpy.types.Operator = object
    bpy.props = SimpleNamespace(
        BoolProperty=lambda **_kwargs: None,
        EnumProperty=lambda **_kwargs: None,
        FloatProperty=lambda **_kwargs: None,
        FloatVectorProperty=lambda **_kwargs: None,
        IntProperty=lambda **_kwargs: None,
        StringProperty=lambda **_kwargs: None,
    )

    infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
    infrastructure.cancel_native_history = lambda: None
    infrastructure.clear_native_rna_badge = lambda: None
    infrastructure.commit_native_history = lambda *_args: None
    infrastructure.disable_overlay = lambda: None
    infrastructure.enable_overlay = lambda *_args: None
    infrastructure.overlay_enabled = lambda: False
    infrastructure.prepare_native_history = lambda *_args: None
    infrastructure.prepared_native_history_changed = lambda *_args: False
    infrastructure.remember_native_rna_badge = lambda *_args, **_kwargs: True
    infrastructure.remove_factory_startup_objects = lambda *_args: False
    infrastructure.resolve_resource = lambda *_args: None
    infrastructure.try_activate_native_rna_button = lambda *_args, **_kwargs: None
    sys.modules[infrastructure.__name__] = infrastructure

    package = sys.modules[PACKAGE_NAME]
    package.get_session = lambda: None
    package.get_companion = lambda: None
    module_name = f"{PACKAGE_NAME}.presentation.operators"
    sys.modules.pop(module_name, None)
    return import_module(module_name)


def _action_step(step_id="snowman.model.body_lower"):
    return domain.TaskNode(
        id=step_id,
        number="1.2.1",
        title="Create the lower body",
        order=1,
        action=domain.ActionSpec(
            adapter_id="blender",
            name="blender.mesh.create_uv_sphere",
            arguments={
                "resourceId": "snowman.body.lower",
                "objectName": "OperatingLine.Snowman.BodyLower",
                "radius": 1.75,
                "location": [0, 0, -1.5],
            },
        ),
        anchors=(
            {
                "kind": "operator",
                "operatorId": "mesh.primitive_uv_sphere_add",
                "menuPath": ["Add", "Mesh", "UV Sphere"],
            },
        ),
    )


def _candidate_step():
    targets = (
        ("workspace", "Layout", "Use Layout Workspace", {}),
        ("semantic", "operatingline.blender.accepted_active_mesh", "Use Accepted Active Mesh", {}),
        ("control", "VIEW3D_HT_header.mode", "Choose Edit Mode", {"value": "EDIT"}),
        ("menu", "VIEW3D_MT_select_edit_mesh", "Open Select Menu", {}),
        ("operator", "mesh.select_all", "Select All Mesh Elements", {"action": "SELECT"}),
        ("menu", "VIEW3D_MT_edit_mesh_edges", "Open Edge Menu", {}),
        ("operator", "mesh.subdivide", "Choose Subdivide", {}),
        ("operator", "screen.redo_last", "Open Adjust Last Operation", {}),
        ("control", "mesh.subdivide.number_cuts", "Set Number of Cuts", {"value": 2}),
        ("control", "mesh.subdivide.smoothness", "Set Smoothness", {"value": 0.5}),
        ("control", "VIEW3D_HT_header.mode", "Return to Object Mode", {"value": "OBJECT"}),
    )
    projection = domain.CandidateMenuProjectionSpec(
        projection="candidate_only",
        interaction_catalog_version="1.50.0",
        id="blender.mesh.edit_subdivide.menu-candidate",
        modality="menu",
        equivalence="not_equivalent_to_managed_action",
        execution_authority="none",
        title="Native Subdivide candidate",
        reason="Native in-place mutation is not the managed replacement action.",
        preconditions=({"kind": "workspace", "label": "Workspace", "value": "Layout"},),
        operations=tuple(
            {
                "id": f"candidate.operation_{index:02d}",
                "order": index,
                "semanticRefs": ["subdivide"],
                "description": label,
                "evidenceRefs": [],
                "intent": "execute" if host_id == "mesh.subdivide" else "configure",
                "target": {"kind": kind, "hostId": host_id},
                "path": [label],
                "parameters": parameters,
            }
            for index, (kind, host_id, label, parameters) in enumerate(targets, start=1)
        ),
        omitted_action_arguments=(),
    )
    return domain.TaskNode(
        id="edit.subdivide",
        number="1.1",
        title="Subdivide",
        order=1,
        action=domain.ActionSpec(
            adapter_id="blender",
            name="blender.mesh.edit_subdivide",
            arguments={"cuts": 2, "smooth": 0.5},
        ),
        candidate_menu_projection=projection,
    )


class NativeMenuGuidanceVisibilityStateTests(unittest.TestCase):
    def setUp(self) -> None:
        native_guidance.disable_native_menu_guidance()
        self.step = _action_step()
        self.session = SimpleNamespace(
            active_index=-1,
            steps=(self.step,),
            observation_blocked=False,
            guidance_step=self.step,
        )
        self.provider = lambda: self.session
        self.assertTrue(native_guidance.enable_native_menu_guidance(self.provider))

    def tearDown(self) -> None:
        native_guidance.disable_native_menu_guidance()

    def test_hide_then_show_preserves_the_revealed_leaf_operation(self) -> None:
        self.assertTrue(native_guidance.reveal_native_menu("Add"))
        self.assertTrue(native_guidance.reveal_native_menu("Mesh"))
        before_hide = native_guidance.interaction_guidance_snapshot()
        assert before_hide is not None
        self.assertEqual(before_hide.revealed_depth, 3)

        native_guidance.disable_native_menu_guidance(reset_tracker=False)
        self.assertTrue(native_guidance.enable_native_menu_guidance(self.provider))

        after_show = native_guidance.interaction_guidance_snapshot()
        assert after_show is not None
        self.assertEqual(after_show.revealed_depth, 3)
        self.assertEqual(
            tuple(item.role for item in after_show.items),
            (
                application.MenuGuidanceRole.COMPLETED,
                application.MenuGuidanceRole.PREVIOUS,
                application.MenuGuidanceRole.CURRENT,
                application.MenuGuidanceRole.NEXT,
            ),
        )

    def test_default_disable_resets_reveal_state_for_addon_teardown(self) -> None:
        self.assertTrue(native_guidance.reveal_native_menu("Mesh"))

        native_guidance.disable_native_menu_guidance()
        self.assertTrue(native_guidance.enable_native_menu_guidance(self.provider))

        snapshot = native_guidance.interaction_guidance_snapshot()
        assert snapshot is not None
        self.assertEqual(snapshot.revealed_depth, 1)
        self.assertEqual(snapshot.items[0].role, application.MenuGuidanceRole.CURRENT)
        self.assertEqual(snapshot.items[1].role, application.MenuGuidanceRole.NEXT)

    def test_candidate_snapshot_is_separate_and_cannot_match_managed_execution(self) -> None:
        candidate = _candidate_step()
        self.session.steps = (candidate,)
        self.session.guidance_step = candidate

        snapshot = native_guidance.candidate_menu_snapshot()

        assert snapshot is not None
        self.assertEqual(len(snapshot.operations), 11)
        self.assertIsNone(native_guidance.native_menu_snapshot())
        self.assertFalse(snapshot.accepts("mesh.subdivide"))
        self.assertFalse(
            native_guidance.guided_menu_action_matches(
                candidate.id,
                "mesh.subdivide",
            )
        )

    def test_candidate_patches_only_native_select_and_subdivide_controls(self) -> None:
        candidate = _candidate_step()
        self.session.steps = (candidate,)
        self.session.guidance_step = candidate
        context = SimpleNamespace(mode="EDIT_MESH")

        header_layout = _Layout()
        native_guidance._draw_editor_guided(
            SimpleNamespace(layout=header_layout),
            context,
        )
        select_layout = _Layout()
        native_guidance._draw_select_edit_mesh_guided(
            SimpleNamespace(layout=select_layout),
            context,
        )
        edge_layout = _Layout()
        native_guidance._draw_edit_mesh_edges_guided(
            SimpleNamespace(layout=edge_layout),
            context,
        )

        header_text = tuple(
            call[2].get("text", "")
            for call in header_layout.calls
            if call[0] == "menu"
        )
        self.assertTrue(any("04 CANDIDATE" in text for text in header_text))
        self.assertTrue(any("06 CANDIDATE" in text for text in header_text))
        select_call = next(
            call for call in select_layout.calls
            if call[0] == "operator" and call[1] == "mesh.select_all"
        )
        self.assertEqual(select_call[3].action, "SELECT")
        self.assertIn("05 CANDIDATE ONLY", select_call[2]["text"])
        edge_call = next(
            call for call in edge_layout.calls
            if call[0] == "operator" and call[1] == "mesh.subdivide"
        )
        self.assertIn("07 CANDIDATE ONLY", edge_call[2]["text"])
        self.assertFalse(
            any(call[1].startswith("operating_line.") for call in select_layout.calls if call[0] == "operator")
        )
        self.assertFalse(
            any(call[1].startswith("operating_line.") for call in edge_layout.calls if call[0] == "operator")
        )


class MarkerToggleStateTests(unittest.TestCase):
    def test_hiding_markers_disables_native_patches_without_resetting_reveal(self) -> None:
        operators = _load_operators()
        reset_tracker_arguments: list[bool] = []
        operators.overlay_enabled = lambda: True
        operators.disable_native_menu_guidance = (
            lambda *, reset_tracker=True: reset_tracker_arguments.append(reset_tracker)
        )
        operators.disable_overlay = lambda: None
        context = SimpleNamespace(
            window_manager=SimpleNamespace(operating_line_overlay_enabled=True)
        )

        result = operators.OPERATINGLINE_OT_toggle_overlay().execute(context)

        self.assertEqual(result, {"FINISHED"})
        self.assertEqual(reset_tracker_arguments, [False])
        self.assertFalse(context.window_manager.operating_line_overlay_enabled)


class LeafInstructionOperatorTests(unittest.TestCase):
    def setUp(self) -> None:
        native_guidance.disable_native_menu_guidance()
        self.step = _action_step()
        self.session = SimpleNamespace(
            active_index=-1,
            steps=(self.step,),
            observation_blocked=False,
            guidance_step=self.step,
        )
        self.assertTrue(
            native_guidance.enable_native_menu_guidance(lambda: self.session)
        )
        self.operators = _load_operators()
        self.operators._session = lambda: self.session

    def tearDown(self) -> None:
        native_guidance.disable_native_menu_guidance()

    @staticmethod
    def _configure(operator, snapshot) -> None:
        operator.step_id = snapshot.step_id
        operator.operation_id = snapshot.focused_operation.operation_id
        operator.ordinal = snapshot.focused_ordinal
        operator.cursor_token = snapshot.cursor_token

    def test_leaf_back_next_and_retry_never_advance_the_global_session(self) -> None:
        initial = native_guidance.leaf_guidance_snapshot(self.step)
        assert initial is not None
        forward = self.operators.OPERATINGLINE_OT_leaf_operation_next()
        self._configure(forward, initial)

        self.assertEqual(forward.execute(None), {"FINISHED"})
        self.assertEqual(self.session.active_index, -1)
        focused = native_guidance.leaf_guidance_snapshot(self.step)
        assert focused is not None
        self.assertEqual(focused.focused_ordinal, 2)
        self.assertEqual(focused.revealed_depth, 1)

        retry = self.operators.OPERATINGLINE_OT_leaf_operation_retry()
        self._configure(retry, focused)
        self.assertEqual(retry.execute(None), {"FINISHED"})
        retried = native_guidance.leaf_guidance_snapshot(self.step)
        assert retried is not None
        self.assertEqual(retried.focused_ordinal, 2)
        self.assertEqual(retried.retry_serial, 1)
        self.assertEqual(self.session.active_index, -1)

        back = self.operators.OPERATINGLINE_OT_leaf_operation_back()
        self._configure(back, retried)
        self.assertEqual(back.execute(None), {"FINISHED"})
        restored = native_guidance.leaf_guidance_snapshot(self.step)
        assert restored is not None
        self.assertEqual(restored.focused_ordinal, 1)
        self.assertEqual(self.session.active_index, -1)

    def test_stale_leaf_instruction_button_fails_closed(self) -> None:
        snapshot = native_guidance.leaf_guidance_snapshot(self.step)
        assert snapshot is not None
        operator = self.operators.OPERATINGLINE_OT_leaf_operation_next()
        operator.step_id = "stale.leaf"
        operator.operation_id = snapshot.focused_operation.operation_id
        operator.ordinal = snapshot.focused_ordinal
        operator.cursor_token = snapshot.cursor_token
        reports = []
        operator.report = lambda levels, message: reports.append((levels, message))

        self.assertEqual(operator.execute(None), {"CANCELLED"})
        self.assertEqual(self.session.active_index, -1)
        self.assertTrue(reports)
        unchanged = native_guidance.leaf_guidance_snapshot(self.step)
        assert unchanged is not None
        self.assertEqual(unchanged.focused_ordinal, 1)

    def test_stale_button_cannot_move_replacement_leaf_with_the_same_ids(self) -> None:
        snapshot = native_guidance.leaf_guidance_snapshot(self.step)
        assert snapshot is not None
        operator = self.operators.OPERATINGLINE_OT_leaf_operation_next()
        self._configure(operator, snapshot)
        reports = []
        operator.report = lambda levels, message: reports.append((levels, message))

        replacement = _action_step()
        self.session.steps = (replacement,)
        self.session.guidance_step = replacement

        self.assertEqual(operator.execute(None), {"CANCELLED"})
        self.assertTrue(reports)
        replacement_snapshot = native_guidance.leaf_guidance_snapshot(replacement)
        assert replacement_snapshot is not None
        self.assertEqual(replacement_snapshot.focused_ordinal, 1)
        self.assertNotEqual(replacement_snapshot.cursor_token, snapshot.cursor_token)

    def test_blocking_gate_keeps_native_guidance_on_the_failed_middle_leaf(self) -> None:
        following = _action_step("snowman.model.following")
        self.session.steps = (self.step, following)
        self.session.active_index = 0
        self.session.observation_blocked = True
        self.session.guidance_step = self.step

        snapshot = native_guidance.interaction_guidance_snapshot()

        assert snapshot is not None
        self.assertEqual(snapshot.step_id, self.step.id)
        forward = self.operators.OPERATINGLINE_OT_leaf_operation_next()
        self._configure(forward, snapshot)
        self.assertEqual(forward.execute(None), {"FINISHED"})
        browsed = native_guidance.interaction_guidance_snapshot()
        assert browsed is not None
        self.assertEqual(browsed.focused_ordinal, 2)
        self.assertEqual(self.session.active_index, 0)
        retry = self.operators.OPERATINGLINE_OT_leaf_operation_retry()
        self._configure(retry, browsed)
        self.assertEqual(retry.execute(None), {"FINISHED"})
        retried = native_guidance.interaction_guidance_snapshot()
        assert retried is not None
        self.assertEqual(retried.step_id, self.step.id)
        self.assertEqual(retried.focused_ordinal, 2)
        self.assertEqual(retried.retry_serial, 1)
        self.assertFalse(
            native_guidance.guided_menu_action_matches(
                self.step.id,
                "mesh.primitive_uv_sphere_add",
            )
        )

    def test_retry_on_blocked_final_leaf_does_not_read_past_the_plan(self) -> None:
        self.session.active_index = 0
        self.session.observation_blocked = True
        self.session.guidance_step = self.step
        snapshot = native_guidance.interaction_guidance_snapshot()
        assert snapshot is not None
        retry = self.operators.OPERATINGLINE_OT_leaf_operation_retry()
        self._configure(retry, snapshot)

        self.assertEqual(retry.execute(None), {"FINISHED"})
        retried = native_guidance.interaction_guidance_snapshot()
        assert retried is not None
        self.assertEqual(retried.step_id, self.step.id)
        self.assertEqual(retried.focused_ordinal, 1)
        self.assertEqual(retried.retry_serial, 1)

    def test_browsing_to_the_final_menu_instruction_does_not_authorize_execution(self) -> None:
        snapshot = native_guidance.leaf_guidance_snapshot(self.step)
        assert snapshot is not None
        while snapshot.focused_ordinal < 4:
            self.assertTrue(
                native_guidance.focus_next_leaf_operation(
                    self.step,
                    snapshot.focused_operation.operation_id,
                    snapshot.focused_ordinal,
                    snapshot.cursor_token,
                )
            )
            snapshot = native_guidance.leaf_guidance_snapshot(self.step)
            assert snapshot is not None

        self.assertEqual(snapshot.focused_ordinal, 4)
        self.assertEqual(snapshot.revealed_depth, 1)
        self.assertFalse(
            native_guidance.guided_menu_action_matches(
                self.step.id,
                "mesh.primitive_uv_sphere_add",
            )
        )
        self.assertTrue(native_guidance.reveal_native_menu("Add"))
        self.assertTrue(native_guidance.reveal_native_menu("Mesh"))
        self.assertTrue(
            native_guidance.guided_menu_action_matches(
                self.step.id,
                "mesh.primitive_uv_sphere_add",
            )
        )


if __name__ == "__main__":
    unittest.main()
