"""Projection tests for the viewport's leaf-local operation rail."""

from enum import Enum
from importlib import import_module
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_leaf_guidance_overlay_test"


class _GuidanceState(Enum):
    COMPLETED = "completed"
    BACK = "back"
    NEXT = "next"
    LOCKED = "locked"


class _SpaceView3D:
    added: list[tuple] = []
    removed: list[tuple] = []
    fail_remove = False

    def __init__(self) -> None:
        self.region_3d = SimpleNamespace()

    @classmethod
    def draw_handler_add(cls, *args):
        handle = ("VIEW_3D", len(cls.added) + 1)
        cls.added.append((*args, handle))
        return handle

    @classmethod
    def draw_handler_remove(cls, *args):
        cls.removed.append(args)
        if cls.fail_remove:
            raise RuntimeError("viewport handler removal failed")


class _SpaceNodeEditor:
    added: list[tuple] = []
    removed: list[tuple] = []
    fail_add = False
    fail_remove = False

    def __init__(self, *, edit_tree=None) -> None:
        self.edit_tree = edit_tree
        self.tree_type = "GeometryNodeTree"

    @classmethod
    def draw_handler_add(cls, *args):
        if cls.fail_add:
            raise RuntimeError("node handler registration failed")
        handle = ("NODE_EDITOR", len(cls.added) + 1)
        cls.added.append((*args, handle))
        return handle

    @classmethod
    def draw_handler_remove(cls, *args):
        cls.removed.append(args)
        if cls.fail_remove:
            raise RuntimeError("node handler removal failed")


def _load_overlay():
    for name in ("blf", "bpy", "gpu", "bpy_extras", "gpu_extras"):
        sys.modules.pop(name, None)

    blf = ModuleType("blf")
    blf.color = lambda *_args: None
    blf.size = lambda *_args: None
    blf.position = lambda *_args: None
    blf.draw = lambda *_args: None
    blf.dimensions = lambda *_args: (20.0, 10.0)
    sys.modules[blf.__name__] = blf

    bpy = ModuleType("bpy")
    bpy.types = SimpleNamespace(
        SpaceView3D=_SpaceView3D,
        SpaceNodeEditor=_SpaceNodeEditor,
        Object=object,
        NodeTree=object,
    )
    bpy.context = SimpleNamespace(
        region=SimpleNamespace(width=800, height=600),
        space_data=_SpaceView3D(),
    )
    sys.modules[bpy.__name__] = bpy

    gpu = ModuleType("gpu")
    gpu.shader = SimpleNamespace(from_builtin=lambda _name: SimpleNamespace())
    gpu.state = SimpleNamespace(blend_set=lambda _mode: None)
    sys.modules[gpu.__name__] = gpu

    bpy_extras = ModuleType("bpy_extras")
    bpy_extras.view3d_utils = SimpleNamespace(
        location_3d_to_region_2d=lambda *_args: None
    )
    sys.modules[bpy_extras.__name__] = bpy_extras

    gpu_extras = ModuleType("gpu_extras")
    gpu_extras.batch = ModuleType("gpu_extras.batch")
    gpu_extras.batch.batch_for_shader = lambda *_args, **_kwargs: SimpleNamespace()
    sys.modules[gpu_extras.__name__] = gpu_extras
    sys.modules[gpu_extras.batch.__name__] = gpu_extras.batch

    package = ModuleType(PACKAGE_NAME)
    package.__path__ = [str(PACKAGE_ROOT)]
    sys.modules[package.__name__] = package

    application = ModuleType(f"{PACKAGE_NAME}.application")
    application.GuidanceState = _GuidanceState
    application.GuidanceStep = object
    application.relevant_steps = lambda *_args, **_kwargs: ()
    application.step_state = lambda *_args, **_kwargs: _GuidanceState.NEXT
    sys.modules[application.__name__] = application

    visual_theme = ModuleType(f"{PACKAGE_NAME}.visual_theme")
    visual_theme.HALO = (0.0, 0.0, 0.0, 1.0)
    visual_theme.MUTED_TEXT = (0.5, 0.5, 0.5, 1.0)
    visual_theme.SURFACE = (0.1, 0.1, 0.1, 1.0)
    visual_theme.TEXT = (1.0, 1.0, 1.0, 1.0)
    visual_theme.color_for = lambda _state: (0.2, 0.6, 1.0, 1.0)
    sys.modules[visual_theme.__name__] = visual_theme

    infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
    infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
    sys.modules[infrastructure.__name__] = infrastructure

    snowman_actions = ModuleType(
        f"{PACKAGE_NAME}.infrastructure.snowman_actions"
    )
    snowman_actions.build_resource_registry = lambda *_args: {}
    snowman_actions.resolve_receipt_anchor = lambda *_args: None
    snowman_actions.resolve_resource = lambda *_args: None
    sys.modules[snowman_actions.__name__] = snowman_actions

    module_name = f"{PACKAGE_NAME}.infrastructure.overlay"
    sys.modules.pop(module_name, None)
    return import_module(module_name)


def _item(ordinal: int, label: str):
    return SimpleNamespace(
        ordinal=ordinal,
        label=label,
        state=_GuidanceState.NEXT,
        parameters=(),
        reference=False,
    )


def _parameter_operation(
    ordinal: int,
    label: str,
    name: str,
    display_value: str,
):
    return SimpleNamespace(
        ordinal=ordinal,
        label=label,
        state=_GuidanceState.LOCKED,
        parameters=(SimpleNamespace(name=name, display_value=display_value),),
        reference=True,
    )


def _node_operation(
    ordinal: int,
    operation_id: str,
    target_id: str,
    *,
    state: _GuidanceState = _GuidanceState.LOCKED,
    reference: bool = True,
):
    return SimpleNamespace(
        ordinal=ordinal,
        operation_id=operation_id,
        label=f"Add {target_id}",
        intent="execute",
        target_kind="node",
        target_id=target_id,
        state=state,
        parameters=(),
        reference=reference,
        connection=None,
    )


def _semantic_operation(
    ordinal: int,
    operation_id: str,
    target_kind: str,
):
    return SimpleNamespace(
        ordinal=ordinal,
        operation_id=operation_id,
        label=operation_id,
        intent="execute",
        target_kind=target_kind,
        target_id=operation_id,
        state=_GuidanceState.LOCKED,
        parameters=(),
        reference=True,
        connection=(
            SimpleNamespace(
                from_node="NodeGroupInput",
                from_socket="Geometry",
                to_node="GeometryNodeTransform",
                to_socket="Geometry",
            )
            if target_kind == "connection"
            else None
        ),
    )


def _node(
    bl_idname: str,
    *,
    name: str | None = None,
    location=(20.0, 180.0),
    dimensions=(160.0, 80.0),
    node_type="DEFAULT",
    hide=False,
):
    return SimpleNamespace(
        bl_idname=bl_idname,
        name=name,
        location_absolute=location,
        dimensions=dimensions,
        type=node_type,
        hide=hide,
    )


def _node_context(
    tree,
    *,
    width: int = 800,
    height: int = 600,
    ui_scale: float = 1.0,
):
    view2d = SimpleNamespace(
        view_to_region=lambda x, y, clip=False: (float(x), float(y))
    )
    return SimpleNamespace(
        region=SimpleNamespace(width=width, height=height, view2d=view2d),
        space_data=_SpaceNodeEditor(edit_tree=tree),
        preferences=SimpleNamespace(
            system=SimpleNamespace(ui_scale=ui_scale),
        ),
    )


def _node_snapshot(
    operations,
    *,
    step_id="geometry-step",
    cursor_token="cursor-1",
    recipe_id="blender.geometry_nodes.create_transform.semantic",
):
    operations = tuple(operations)
    return SimpleNamespace(
        step_id=step_id,
        recipe_id=recipe_id,
        cursor_token=cursor_token,
        focused_ordinal=operations[0].ordinal if operations else 1,
        focused_operation=operations[0] if operations else None,
        operations=operations,
        retry_serial=0,
    )


def _node_session(tree, *, step_id="geometry-step", with_receipt=True):
    action = SimpleNamespace(
        name="blender.geometry_nodes.create_transform",
        arguments={
            "nodeGroupId": "visual.geometry.node_group",
            "nodeGroupName": "OperatingLine Geometry",
        },
    )
    step = SimpleNamespace(id=step_id, action=action)
    return SimpleNamespace(
        guidance_step=step,
        receipts={step_id: SimpleNamespace()} if with_receipt else {},
        _test_node_tree=tree,
    )


class LeafGuidanceOverlayProjectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.overlay = _load_overlay()

    def test_complete_operations_take_precedence_over_legacy_menu_items(self) -> None:
        legacy_items = tuple(_item(index, label) for index, label in enumerate(
            ("Layout", "Add", "Mesh", "UV Sphere"), start=1
        ))
        operations = legacy_items + (
            _parameter_operation(5, "Location", "value", "[0, 0, -1.5]"),
            _parameter_operation(6, "Scale", "value", "[1.75, 1.75, 1.75]"),
            _parameter_operation(7, "Object Name", "value", '"Snowman.Body"'),
        )
        snapshot = SimpleNamespace(items=legacy_items, operations=operations)

        projected = self.overlay._leaf_operations(snapshot)

        self.assertEqual(tuple(item.ordinal for item in projected), tuple(range(1, 8)))
        self.assertEqual(projected[-1].label, "Object Name")

    def test_missing_complete_operations_fail_closed_instead_of_using_menu_items(self) -> None:
        snapshot = SimpleNamespace(items=(_item(1, "Layout"), _item(2, "Add")))

        projected = self.overlay._leaf_operations(snapshot)

        self.assertEqual(projected, ())

    def test_parameter_projection_preserves_exact_display_values(self) -> None:
        operation = SimpleNamespace(
            parameters=(
                SimpleNamespace(name="location", display_value="[0, 0, -1.5]"),
                SimpleNamespace(name="name", display_value='"Snowman.Body"'),
            )
        )

        text = self.overlay._operation_parameter_text(operation)

        self.assertEqual(
            text,
            'location=[0, 0, -1.5], name="Snowman.Body"',
        )

    def test_visible_operation_window_includes_middle_focus_and_keeps_ordinals(self) -> None:
        operations = tuple(_item(index, f"Operation {index}") for index in range(1, 13))

        visible = self.overlay._visible_leaf_operations(operations, 8)

        self.assertEqual(tuple(item.ordinal for item in visible), (5, 6, 7, 8, 9, 10, 11))

    def test_visible_operation_window_clamps_near_start(self) -> None:
        operations = tuple(_item(index, f"Operation {index}") for index in range(1, 13))

        visible = self.overlay._visible_leaf_operations(operations, 2)

        self.assertEqual(tuple(item.ordinal for item in visible), (1, 2, 3, 4, 5, 6, 7))

    def test_visible_operation_window_clamps_near_end(self) -> None:
        operations = tuple(_item(index, f"Operation {index}") for index in range(1, 13))

        visible = self.overlay._visible_leaf_operations(operations, 12)

        self.assertEqual(tuple(item.ordinal for item in visible), (6, 7, 8, 9, 10, 11, 12))

    def test_visible_operation_window_honors_limit_and_short_rails(self) -> None:
        operations = tuple(_item(index, f"Operation {index}") for index in range(1, 5))

        self.assertEqual(
            self.overlay._visible_leaf_operations(operations, 3),
            operations,
        )
        self.assertEqual(
            self.overlay._visible_leaf_operations(operations, 3, limit=0),
            (),
        )

    def test_compact_label_preserves_short_text_and_ellipsizes_long_text(self) -> None:
        self.assertEqual(self.overlay._compact_label("UV Sphere"), "UV Sphere")
        compact = self.overlay._compact_label("Set Geometry Node Input", limit=12)

        self.assertEqual(compact, "Set Geometr…")
        self.assertEqual(len(compact), 12)

    def test_draw_uses_all_seven_operations_instead_of_four_legacy_items(self) -> None:
        operations = (
            _item(1, "Layout"),
            _item(2, "Add"),
            _item(3, "Mesh"),
            _item(4, "UV Sphere"),
            _parameter_operation(5, "Location", "value", "[0, 0, -1.5]"),
            _parameter_operation(6, "Scale", "value", "[1.75, 1.75, 1.75]"),
            _parameter_operation(7, "Object Name", "value", '"Snowman.Body"'),
        )
        snapshot = SimpleNamespace(
            native=True,
            items=operations[:4],
            operations=operations,
            focused_ordinal=1,
        )
        leaf = SimpleNamespace(title="Create lower body", anchors=())
        session = SimpleNamespace(
            active_index=-1,
            active_step=None,
            steps=(leaf,),
            observation_blocked=False,
            receipts={},
        )
        context_item = SimpleNamespace(
            index=0,
            state=_GuidanceState.NEXT,
        )
        badges: list[int] = []
        text: list[str] = []
        centered: list[str] = []
        self.overlay._session_provider = lambda: session
        self.overlay._menu_guidance_provider = lambda: snapshot
        self.overlay._context_steps = lambda _session: (context_item,)
        self.overlay._screen_anchor = lambda *_args: None
        self.overlay._draw_rect = lambda *_args: None
        self.overlay._draw_segment = lambda *_args: None
        self.overlay._draw_guide_line = lambda *_args: None
        self.overlay._draw_badge = (
            lambda _shader, _center, ordinal, _state, **_kwargs: badges.append(ordinal)
        )
        self.overlay._draw_text = (
            lambda value, *_args, **_kwargs: text.append(value)
        )
        self.overlay._draw_centered_text = (
            lambda value, *_args, **_kwargs: centered.append(value)
        )

        self.overlay._draw_overlay()

        self.assertEqual(badges[-7:], list(range(1, 8)))
        self.assertIn("LEAF OPERATIONS  01–07 · markers only on verified targets", text)
        self.assertTrue(any(line.startswith("07 Object Name:") for line in text))
        self.assertEqual(centered[-7:], [
            "Layout",
            "Add",
            "Mesh",
            "UV Sphere",
            "Location",
            "Scale",
            "Object Name",
        ])

    def test_draw_window_tracks_focused_operation_on_long_leaf(self) -> None:
        operations = tuple(
            _item(index, f"Operation {index}") for index in range(1, 13)
        )
        snapshot = SimpleNamespace(
            native=True,
            operations=operations,
            focused_ordinal=12,
        )
        leaf = SimpleNamespace(title="Long leaf", anchors=())
        session = SimpleNamespace(
            active_index=-1,
            active_step=None,
            steps=(leaf,),
            observation_blocked=False,
            receipts={},
        )
        context_item = SimpleNamespace(index=0, state=_GuidanceState.NEXT)
        badges: list[int] = []
        self.overlay._session_provider = lambda: session
        self.overlay._menu_guidance_provider = lambda: snapshot
        self.overlay._context_steps = lambda _session: (context_item,)
        self.overlay._screen_anchor = lambda *_args: None
        self.overlay._draw_rect = lambda *_args: None
        self.overlay._draw_segment = lambda *_args: None
        self.overlay._draw_guide_line = lambda *_args: None
        self.overlay._draw_badge = (
            lambda _shader, _center, ordinal, _state, **_kwargs: badges.append(ordinal)
        )
        self.overlay._draw_text = lambda *_args, **_kwargs: None
        self.overlay._draw_centered_text = lambda *_args, **_kwargs: None

        self.overlay._draw_overlay()

        self.assertEqual(badges[-7:], [6, 7, 8, 9, 10, 11, 12])

    def test_candidate_draws_all_eleven_steps_and_non_managed_warning(self) -> None:
        operations = tuple(
            _parameter_operation(index, f"Operation {index}", "value", str(index))
            if index in {3, 5, 9, 10, 11}
            else _item(index, f"Operation {index}")
            for index in range(1, 12)
        )
        snapshot = SimpleNamespace(
            native=False,
            candidate_only=True,
            operations=operations,
            focused_ordinal=1,
        )
        leaf = SimpleNamespace(title="Subdivide", anchors=())
        session = SimpleNamespace(
            active_index=-1,
            active_step=None,
            steps=(leaf,),
            observation_blocked=False,
            receipts={},
        )
        context_item = SimpleNamespace(index=0, state=_GuidanceState.NEXT)
        badges: list[int] = []
        text: list[str] = []
        self.overlay._session_provider = lambda: session
        self.overlay._menu_guidance_provider = lambda: snapshot
        self.overlay._context_steps = lambda _session: (context_item,)
        self.overlay._screen_anchor = lambda *_args: None
        self.overlay._draw_rect = lambda *_args: None
        self.overlay._draw_segment = lambda *_args: None
        self.overlay._draw_guide_line = lambda *_args: None
        self.overlay._draw_badge = (
            lambda _shader, _center, ordinal, _state, **_kwargs: badges.append(ordinal)
        )
        self.overlay._draw_text = lambda value, *_args, **_kwargs: text.append(value)
        self.overlay._draw_centered_text = lambda *_args, **_kwargs: None

        self.overlay._draw_overlay()

        self.assertEqual(badges[-11:], list(range(1, 12)))
        self.assertIn(
            "CANDIDATE ONLY  01–11 · native in-place · no managed receipt or replacement",
            text,
        )
        for ordinal in (3, 5, 9, 10, 11):
            self.assertTrue(any(line.startswith(f"{ordinal:02d} ") for line in text))


class NodeEditorOverlayLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        _SpaceView3D.added.clear()
        _SpaceView3D.removed.clear()
        _SpaceView3D.fail_remove = False
        _SpaceNodeEditor.added.clear()
        _SpaceNodeEditor.removed.clear()
        _SpaceNodeEditor.fail_add = False
        _SpaceNodeEditor.fail_remove = False
        self.overlay = _load_overlay()

    def tearDown(self) -> None:
        _SpaceView3D.fail_remove = False
        _SpaceNodeEditor.fail_add = False
        _SpaceNodeEditor.fail_remove = False

    def test_enable_registers_one_viewport_and_one_node_editor_handler(self) -> None:
        self.overlay.enable_overlay(lambda: None, lambda: None)

        self.assertEqual(len(_SpaceView3D.added), 1)
        self.assertEqual(len(_SpaceNodeEditor.added), 1)
        self.assertTrue(self.overlay.overlay_enabled())

    def test_repeated_enable_does_not_register_duplicate_handlers(self) -> None:
        self.overlay.enable_overlay(lambda: None, lambda: None)
        self.overlay.enable_overlay(lambda: None, lambda: None)

        self.assertEqual(len(_SpaceView3D.added), 1)
        self.assertEqual(len(_SpaceNodeEditor.added), 1)

    def test_disable_removes_both_handlers_once_and_is_idempotent(self) -> None:
        self.overlay.enable_overlay(lambda: None, lambda: None)
        self.overlay.disable_overlay()
        self.overlay.disable_overlay()

        self.assertEqual(len(_SpaceView3D.removed), 1)
        self.assertEqual(len(_SpaceNodeEditor.removed), 1)
        self.assertFalse(self.overlay.overlay_enabled())

    def test_node_handler_registration_failure_rolls_back_viewport_handler(self) -> None:
        _SpaceNodeEditor.fail_add = True

        with self.assertRaisesRegex(RuntimeError, "node handler registration failed"):
            self.overlay.enable_overlay(lambda: None, lambda: None)

        self.assertEqual(len(_SpaceView3D.removed), 1)
        self.assertEqual(_SpaceNodeEditor.removed, [])
        self.assertFalse(self.overlay.overlay_enabled())
        self.assertIsNone(self.overlay._session_provider)
        self.assertIsNone(self.overlay._menu_guidance_provider)

    def test_failed_registration_rollback_stays_tracked_for_cleanup_retry(self) -> None:
        _SpaceNodeEditor.fail_add = True
        _SpaceView3D.fail_remove = True

        with self.assertRaisesRegex(RuntimeError, "rollback remains pending") as raised:
            self.overlay.enable_overlay(lambda: None, lambda: None)

        self.assertTrue(
            any(
                "node handler registration failed" in note
                for note in getattr(raised.exception, "__notes__", ())
            )
        )
        self.assertIsInstance(raised.exception.__cause__, RuntimeError)
        self.assertIsNotNone(self.overlay._view3d_draw_handle)
        self.assertIsNone(self.overlay._node_editor_draw_handle)
        self.assertFalse(self.overlay.overlay_enabled())
        _SpaceNodeEditor.fail_add = False
        _SpaceView3D.fail_remove = False
        self.overlay.disable_overlay()
        self.assertIsNone(self.overlay._view3d_draw_handle)

    def test_partial_disable_failure_can_be_retried_without_losing_providers(self) -> None:
        session_provider = lambda: None
        guidance_provider = lambda: None
        self.overlay.enable_overlay(session_provider, guidance_provider)
        _SpaceNodeEditor.fail_remove = True

        with self.assertRaisesRegex(RuntimeError, "Node Editor"):
            self.overlay.disable_overlay()

        self.assertIsNone(self.overlay._view3d_draw_handle)
        self.assertIsNotNone(self.overlay._node_editor_draw_handle)
        self.assertIs(self.overlay._session_provider, session_provider)
        self.assertIs(self.overlay._menu_guidance_provider, guidance_provider)
        _SpaceNodeEditor.fail_remove = False
        self.overlay.disable_overlay()
        self.assertIsNone(self.overlay._node_editor_draw_handle)
        self.assertIsNone(self.overlay._session_provider)
        self.assertIsNone(self.overlay._menu_guidance_provider)


class NodeEditorMarkerResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.overlay = _load_overlay()
        self.input_node = _node("NodeGroupInput")
        self.transform_node = _node(
            "GeometryNodeTransform", location=(240.0, 220.0), dimensions=(180.0, 100.0)
        )
        self.output_node = _node(
            "NodeGroupOutput", location=(500.0, 180.0), dimensions=(160.0, 80.0)
        )
        self.tree = SimpleNamespace(
            name="OperatingLine Geometry",
            bl_idname="GeometryNodeTree",
            nodes=[self.input_node, self.transform_node, self.output_node],
        )
        self.context = _node_context(self.tree)
        self.session = _node_session(self.tree)
        self.identity = SimpleNamespace(
            resource_type="NODE_GROUP",
            logical_id="visual.geometry.node_group",
            display_name="OperatingLine Geometry",
            receipt_token="receipt-geometry",
            step_id="geometry-step",
            action_name="blender.geometry_nodes.create_transform",
        )
        self.session.receipts = {
            "geometry-step": SimpleNamespace(
                receipt_id="receipt-geometry",
                step_id="geometry-step",
                action_name="blender.geometry_nodes.create_transform",
                created=(self.identity,),
            )
        }
        self.overlay._menu_guidance_provider = (
            lambda: getattr(self, "authoritative_snapshot", None)
        )
        self.overlay.resolve_resource = lambda identity: (
            self.tree if identity is self.identity else None
        )

    def _resolve(self, operations, **snapshot_overrides):
        snapshot = _node_snapshot(operations, **snapshot_overrides)
        self.authoritative_snapshot = snapshot
        return self.overlay._resolve_node_editor_markers(
            self.context,
            self.session,
            snapshot,
        )

    def test_current_receipt_bound_edit_tree_resolves_unique_node_operations(self) -> None:
        operations = (
            _node_operation(3, "add-input", "NodeGroupInput"),
            _node_operation(4, "add-transform", "GeometryNodeTransform"),
            _node_operation(8, "add-output", "NodeGroupOutput"),
        )

        markers = self._resolve(operations)

        self.assertEqual(
            tuple(marker.operation_id for marker in markers),
            ("add-input", "add-transform", "add-output"),
        )
        self.assertEqual(tuple(marker.ordinal for marker in markers), (3, 4, 8))

    def test_receipt_bound_node_names_disambiguate_repeated_light_trails_types(self) -> None:
        trail_rows = _node(
            "GeometryNodeMeshLine",
            name="OperatingLine Trail Rows",
            location=(40.0, 260.0),
        )
        loop_tiles = _node(
            "GeometryNodeMeshLine",
            name="OperatingLine Loop Tiles",
            location=(360.0, 260.0),
        )
        self.tree.nodes = [trail_rows, loop_tiles]
        self.session.guidance_step.action.name = (
            "blender.geometry_nodes.create_light_trails"
        )
        self.identity.action_name = "blender.geometry_nodes.create_light_trails"
        self.session.receipts["geometry-step"].action_name = (
            "blender.geometry_nodes.create_light_trails"
        )
        operations = (
            _node_operation(
                6,
                "trail-rows",
                "node-name:OperatingLine Trail Rows",
            ),
            _node_operation(
                19,
                "loop-tiles",
                "node-name:OperatingLine Loop Tiles",
            ),
        )
        snapshot = _node_snapshot(
            operations,
            recipe_id="blender.geometry_nodes.create_light_trails.semantic",
        )
        self.authoritative_snapshot = snapshot

        markers = self.overlay._resolve_node_editor_markers(
            self.context,
            self.session,
            snapshot,
        )

        self.assertEqual(
            tuple(marker.operation_id for marker in markers),
            ("trail-rows", "loop-tiles"),
        )
        self.assertIs(markers[0].node, trail_rows)
        self.assertIs(markers[1].node, loop_tiles)
        parameter = SimpleNamespace(
            container_target_id="node-name:OperatingLine Loop Tiles",
            target_trust="container_capable",
        )
        self.assertIs(
            self.overlay._marker_for_container(parameter, markers).node,
            loop_tiles,
        )

    def test_named_light_trails_connection_disambiguates_repeated_node_types(self) -> None:
        trail_rows = _node(
            "GeometryNodeMeshLine",
            name="OperatingLine Trail Rows",
            location=(40.0, 260.0),
        )
        loop_tiles = _node(
            "GeometryNodeMeshLine",
            name="OperatingLine Loop Tiles",
            location=(360.0, 260.0),
        )
        tile_instances = _node(
            "GeometryNodeInstanceOnPoints",
            name="OperatingLine Tile Instances",
            location=(680.0, 260.0),
        )
        self.tree.nodes = [trail_rows, loop_tiles, tile_instances]
        self.session.guidance_step.action.name = (
            "blender.geometry_nodes.create_light_trails"
        )
        self.identity.action_name = "blender.geometry_nodes.create_light_trails"
        self.session.receipts["geometry-step"].action_name = (
            "blender.geometry_nodes.create_light_trails"
        )
        operations = (
            _node_operation(
                6,
                "trail-rows",
                "node-name:OperatingLine Trail Rows",
            ),
            _node_operation(
                19,
                "loop-tiles",
                "node-name:OperatingLine Loop Tiles",
            ),
            _node_operation(
                20,
                "tile-instances",
                "node-name:OperatingLine Tile Instances",
            ),
        )
        snapshot = _node_snapshot(
            operations,
            recipe_id="blender.geometry_nodes.create_light_trails.semantic",
        )
        self.authoritative_snapshot = snapshot
        markers = self.overlay._resolve_node_editor_markers(
            self.context,
            self.session,
            snapshot,
        )
        connection = _semantic_operation(50, "connect-tiles", "connection")
        connection.connection = SimpleNamespace(
            from_node="node-name:OperatingLine Loop Tiles",
            from_socket="Mesh",
            to_node="node-name:OperatingLine Tile Instances",
            to_socket="Points",
        )

        points = self.overlay._connection_proxy_points(connection, markers)

        self.assertIsNotNone(points)
        self.assertEqual(points[0], (520.0, 220.0))
        self.assertEqual(points[1], (680.0, 220.0))

    def test_container_capability_becomes_exact_only_for_a_resolved_frame(self) -> None:
        operation = _node_operation(4, "add-transform", "GeometryNodeTransform")
        operation.target_trust = "container_capable"

        unresolved = self.overlay._node_target_status(
            operation,
            direct_marker=None,
            container_marker=None,
            connection_points=None,
        )
        marker = self._resolve((operation,))[0]
        resolved = self.overlay._node_target_status(
            operation,
            direct_marker=marker,
            container_marker=None,
            connection_points=None,
        )

        self.assertEqual(
            unresolved,
            "CONTAINER CAPABLE · current receipt-bound node frame unresolved",
        )
        self.assertEqual(
            resolved,
            "CONTAINER EXACT · node frame resolved · UI interaction not observed",
        )

    def test_guided_parameter_resolves_only_its_exact_container_node(self) -> None:
        markers = self._resolve(
            (
                _node_operation(3, "add-input", "NodeGroupInput"),
                _node_operation(4, "add-transform", "GeometryNodeTransform"),
                _node_operation(8, "add-output", "NodeGroupOutput"),
            )
        )
        operation = SimpleNamespace(
            container_target_id="GeometryNodeTransform",
            target_trust="guided_control",
        )

        marker = self.overlay._marker_for_container(operation, markers)

        self.assertIs(marker.node, self.transform_node)
        self.assertEqual(
            self.overlay._node_target_status(
                operation,
                direct_marker=None,
                container_marker=marker,
                connection_points=None,
            ),
            "GUIDED CONTROL · exact container; native value widget unresolved",
        )

    def test_connection_proxy_anchors_exact_node_frames_not_socket_pixels(self) -> None:
        markers = self._resolve(
            (
                _node_operation(3, "add-input", "NodeGroupInput"),
                _node_operation(4, "add-transform", "GeometryNodeTransform"),
                _node_operation(8, "add-output", "NodeGroupOutput"),
            )
        )
        operation = _semantic_operation(9, "connect-input", "connection")
        operation.target_trust = "guided_control"

        points = self.overlay._connection_proxy_points(operation, markers)

        self.assertEqual(points, ((180.0, 140.0), (240.0, 170.0), (210.0, 155.0)))
        self.assertEqual(
            self.overlay._node_target_status(
                operation,
                direct_marker=None,
                container_marker=None,
                connection_points=points,
            ),
            "GUIDED CONTROL · exact node containers; socket pixels unresolved",
        )

    def test_connection_proxy_fails_closed_when_a_node_type_is_ambiguous(self) -> None:
        duplicate = _node("GeometryNodeTransform", location=(340.0, 240.0))
        duplicate_marker = self.overlay.NodeEditorMarker(
            operation_id="duplicate",
            ordinal=12,
            label="Duplicate",
            state=_GuidanceState.LOCKED,
            node=duplicate,
            bounds=(340.0, 160.0, 500.0, 240.0),
            badge_center=(358.0, 222.0),
            reference=True,
            cursor_token="cursor-1",
        )
        markers = self._resolve(
            (
                _node_operation(3, "add-input", "NodeGroupInput"),
                _node_operation(4, "add-transform", "GeometryNodeTransform"),
            )
        )
        operation = _semantic_operation(9, "connect-input", "connection")

        self.assertIsNone(
            self.overlay._connection_proxy_points(
                operation,
                (*markers, duplicate_marker),
            )
        )

    def test_node_marker_uses_absolute_location_and_dimensions_for_bounds(self) -> None:
        operation = _node_operation(4, "add-transform", "GeometryNodeTransform")

        marker = self._resolve((operation,))[0]

        self.assertEqual(marker.bounds, (240.0, 120.0, 420.0, 220.0))
        self.assertIs(marker.node, self.transform_node)

    def test_node_marker_scales_location_but_not_evaluated_dimensions(self) -> None:
        self.context = _node_context(self.tree, ui_scale=2.0)
        operation = _node_operation(4, "add-transform", "GeometryNodeTransform")

        marker = self._resolve((operation,))[0]

        self.assertEqual(marker.bounds, (480.0, 340.0, 660.0, 440.0))

    def test_missing_or_invalid_ui_scale_fails_closed(self) -> None:
        operation = _node_operation(4, "add-transform", "GeometryNodeTransform")

        for ui_scale in (0.0, -1.0, float("nan"), float("inf"), None):
            with self.subTest(ui_scale=ui_scale):
                self.context = _node_context(self.tree, ui_scale=ui_scale)
                self.assertEqual(self._resolve((operation,)), ())

    def test_node_marker_preserves_reference_state_and_cursor_token(self) -> None:
        operation = _node_operation(
            4,
            "add-transform",
            "GeometryNodeTransform",
            state=_GuidanceState.NEXT,
            reference=True,
        )

        marker = self._resolve((operation,))[0]

        self.assertTrue(marker.reference)
        self.assertIs(marker.state, _GuidanceState.NEXT)
        self.assertEqual(marker.cursor_token, "cursor-1")

    def test_socket_and_connection_operations_do_not_resolve_as_node_markers(self) -> None:
        operations = (
            _node_operation(4, "add-transform", "GeometryNodeTransform"),
            _semantic_operation(9, "connect-input", "connection"),
            _semantic_operation(10, "geometry-socket", "socket"),
        )

        markers = self._resolve(operations)

        self.assertEqual(tuple(marker.operation_id for marker in markers), ("add-transform",))
        self.assertTrue(markers[0].reference)

    def test_missing_current_step_receipt_fails_closed(self) -> None:
        self.session = _node_session(self.tree, with_receipt=False)

        markers = self._resolve(
            (_node_operation(4, "add-transform", "GeometryNodeTransform"),)
        )

        self.assertEqual(markers, ())

    def test_editing_a_different_node_tree_fails_closed(self) -> None:
        self.context = _node_context(SimpleNamespace(nodes=[]))

        markers = self._resolve(
            (_node_operation(4, "add-transform", "GeometryNodeTransform"),)
        )

        self.assertEqual(markers, ())

    def test_stale_snapshot_step_fails_closed(self) -> None:
        markers = self._resolve(
            (_node_operation(4, "add-transform", "GeometryNodeTransform"),),
            step_id="replaced-step",
        )

        self.assertEqual(markers, ())

    def test_empty_snapshot_cursor_token_fails_closed(self) -> None:
        markers = self._resolve(
            (_node_operation(4, "add-transform", "GeometryNodeTransform"),),
            cursor_token="",
        )

        self.assertEqual(markers, ())

    def test_old_nonempty_cursor_token_fails_closed_against_current_snapshot(self) -> None:
        operation = _node_operation(4, "add-transform", "GeometryNodeTransform")
        stale = _node_snapshot((operation,), cursor_token="cursor-old")
        self.authoritative_snapshot = _node_snapshot(
            (operation,),
            cursor_token="cursor-current",
        )

        markers = self.overlay._resolve_node_editor_markers(
            self.context,
            self.session,
            stale,
        )

        self.assertEqual(markers, ())

    def test_receipt_and_action_binding_field_mismatches_fail_closed(self) -> None:
        operation = _node_operation(4, "add-transform", "GeometryNodeTransform")
        receipt = self.session.receipts["geometry-step"]
        cases = (
            ("action name", self.session.guidance_step.action, "name", "other.action"),
            ("receipt step", receipt, "step_id", "other-step"),
            ("receipt action", receipt, "action_name", "other.action"),
            ("resource type", self.identity, "resource_type", "MESH"),
            ("logical id", self.identity, "logical_id", "other.node.group"),
            ("display name", self.identity, "display_name", "Other Geometry"),
            ("receipt token", self.identity, "receipt_token", "other-receipt"),
            ("identity step", self.identity, "step_id", "other-step"),
            ("identity action", self.identity, "action_name", "other.action"),
        )
        for label, target, attribute, invalid_value in cases:
            with self.subTest(label=label):
                original = getattr(target, attribute)
                setattr(target, attribute, invalid_value)
                try:
                    self.assertEqual(self._resolve((operation,)), ())
                finally:
                    setattr(target, attribute, original)

        snapshot = _node_snapshot((operation,))
        snapshot.recipe_id = "other.recipe"
        self.authoritative_snapshot = snapshot
        self.assertEqual(
            self.overlay._resolve_node_editor_markers(
                self.context,
                self.session,
                snapshot,
            ),
            (),
        )

    def test_duplicate_node_type_fails_closed_for_that_operation(self) -> None:
        duplicate = _node("GeometryNodeTransform", location=(300.0, 300.0))
        self.tree.nodes.append(duplicate)

        markers = self._resolve(
            (_node_operation(4, "add-transform", "GeometryNodeTransform"),)
        )

        self.assertEqual(markers, ())

    def test_zero_or_non_finite_node_dimensions_fail_closed(self) -> None:
        invalid_dimensions = (
            (0.0, 80.0),
            (180.0, 0.0),
            (float("nan"), 80.0),
            (180.0, float("inf")),
        )
        operation = _node_operation(4, "add-transform", "GeometryNodeTransform")

        for dimensions in invalid_dimensions:
            with self.subTest(dimensions=dimensions):
                self.transform_node.dimensions = dimensions
                self.assertEqual(self._resolve((operation,)), ())

    def test_non_finite_node_location_fails_closed(self) -> None:
        operation = _node_operation(4, "add-transform", "GeometryNodeTransform")
        self.transform_node.location_absolute = (float("nan"), 220.0)

        markers = self._resolve((operation,))

        self.assertEqual(markers, ())

    def test_collapsed_or_special_node_geometry_fails_closed(self) -> None:
        operation = _node_operation(4, "add-transform", "GeometryNodeTransform")

        for node_type, hidden in (
            ("DEFAULT", True),
            ("FRAME", False),
            ("REROUTE", False),
        ):
            with self.subTest(node_type=node_type, hidden=hidden):
                self.transform_node.type = node_type
                self.transform_node.hide = hidden
                self.assertEqual(self._resolve((operation,)), ())
                self.transform_node.type = "DEFAULT"
                self.transform_node.hide = False

    def test_fully_offscreen_node_fails_closed(self) -> None:
        operation = _node_operation(4, "add-transform", "GeometryNodeTransform")
        self.transform_node.location_absolute = (900.0, 900.0)

        markers = self._resolve((operation,))

        self.assertEqual(markers, ())


class NodeEditorOverlayDrawingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.overlay = _load_overlay()

    def test_draw_badges_preserves_marker_ordinals_and_states(self) -> None:
        first_state = _GuidanceState.NEXT
        second_state = _GuidanceState.LOCKED
        markers = (
            SimpleNamespace(
                operation_id="add-input",
                label="Add Group Input",
                ordinal=3,
                state=first_state,
                badge_center=(40.0, 80.0),
                bounds=(20.0, 20.0, 180.0, 100.0),
                reference=True,
                cursor_token="cursor-1",
            ),
            SimpleNamespace(
                operation_id="add-output",
                label="Add Group Output",
                ordinal=8,
                state=second_state,
                badge_center=(520.0, 80.0),
                bounds=(500.0, 20.0, 660.0, 100.0),
                reference=True,
                cursor_token="cursor-1",
            ),
        )
        tree = SimpleNamespace(nodes=[])
        context = _node_context(tree)
        snapshot = _node_snapshot(
            (
                _node_operation(3, "add-input", "NodeGroupInput"),
                _node_operation(8, "add-output", "NodeGroupOutput"),
            )
        )
        self.overlay.bpy.context = context
        self.overlay._session_provider = lambda: SimpleNamespace()
        self.overlay._menu_guidance_provider = lambda: snapshot
        self.overlay._resolve_node_editor_markers = lambda *_args: markers
        drawn: list[tuple[int, _GuidanceState]] = []
        self.overlay._draw_rect = lambda *_args, **_kwargs: None
        self.overlay._draw_segment = lambda *_args, **_kwargs: None
        self.overlay._draw_badge = (
            lambda _shader, _center, ordinal, state, **_kwargs: drawn.append(
                (ordinal, state)
            )
        )
        drawn_text: list[str] = []
        self.overlay._draw_text = (
            lambda value, *_args, **_kwargs: drawn_text.append(value)
        )

        self.overlay._draw_node_overlay()

        self.assertEqual(drawn, [(3, first_state), (8, second_state)])
        self.assertTrue(
            any(
                "NODE FRAME RESOLVED · REFERENCE ONLY · "
                "UI interaction not observed" in value
                for value in drawn_text
            )
        )
        self.assertTrue(all("not executed" not in value for value in drawn_text))

    def test_node_operation_detail_does_not_repeat_its_label(self) -> None:
        operation = _node_operation(4, "add-transform", "GeometryNodeTransform")

        self.assertIsNone(self.overlay._focused_operation_detail(operation))


if __name__ == "__main__":
    unittest.main()
