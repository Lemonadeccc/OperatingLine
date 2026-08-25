"""Unit tests for optional Blender 5.3+ native RNA control targeting."""

from __future__ import annotations

from importlib import import_module
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_native_rna_targeting_test"

operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
module = import_module(f"{PACKAGE_NAME}.infrastructure.native_rna_targeting")


class _WindowManager:
    def __init__(self, result: object = (120, 240)) -> None:
        self.result = result
        self.calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def try_activate_rna_button(self, *args: object, **kwargs: object) -> object:
        self.calls.append((args, kwargs))
        return self.result


class _View2D:
    def __init__(self) -> None:
        self.offset_x = 0.0
        self.offset_y = 0.0

    def region_to_view(self, x: int, y: int) -> tuple[float, float]:
        return (x + self.offset_x, y + self.offset_y)


def _layout_target():
    socket = SimpleNamespace(
        identifier="Translation",
        name="Translation",
        hide=False,
        hide_value=False,
        enabled=True,
        is_linked=False,
        as_pointer=lambda: 8201,
    )
    node = SimpleNamespace(
        bl_idname="GeometryNodeTransform",
        name="Transform Geometry",
        location_absolute=[10.0, 20.0],
        dimensions=[180.0, 240.0],
        hide=False,
        inputs=[socket],
        as_pointer=lambda: 8101,
    )
    return node, socket


class NativeRnaTargetingTests(unittest.TestCase):
    def tearDown(self) -> None:
        module.clear_native_rna_badge()

    def test_highlights_visible_control_and_returns_window_coordinates(self) -> None:
        window_manager = _WindowManager()
        region = object()
        data = object()

        result = module.try_activate_native_rna_button(
            window_manager,
            region=region,
            data=data,
            property="location",
            index=2,
        )

        self.assertEqual(result.status, "exact_native")
        self.assertEqual(result.window_xy, (120, 240))
        self.assertTrue(result.is_exact)
        self.assertEqual(
            window_manager.calls,
            [(
                (region, data, "location", "HIGHLIGHT"),
                {"warp_cursor_at_button": False, "index": 2},
            )],
        )

    def test_unsupported_host_falls_back_without_calling_any_api(self) -> None:
        result = module.try_activate_native_rna_button(
            object(), region=object(), data=object(), property="scale"
        )

        self.assertEqual(result.status, "unsupported")
        self.assertIsNone(result.window_xy)
        self.assertFalse(result.is_exact)

    def test_non_callable_capability_is_unsupported(self) -> None:
        window_manager = type("WindowManager", (), {"try_activate_rna_button": None})()

        result = module.try_activate_native_rna_button(
            window_manager, region=object(), data=object(), property="scale"
        )

        self.assertEqual(result.status, "unsupported")

    def test_empty_native_result_means_control_is_not_visible(self) -> None:
        for native_result in (None, []):
            with self.subTest(native_result=native_result):
                result = module.try_activate_native_rna_button(
                    _WindowManager(native_result),
                    region=object(),
                    data=object(),
                    property="rotation_euler",
                    index=1,
                )

                self.assertEqual(result.status, "not_visible")
                self.assertIsNone(result.window_xy)

    def test_blender_host_exception_is_returned_as_error(self) -> None:
        class FailingWindowManager:
            def try_activate_rna_button(
                self, *_args: object, **_kwargs: object
            ) -> object:
                raise RuntimeError("region is no longer active")

        result = module.try_activate_native_rna_button(
            FailingWindowManager(),
            region=object(),
            data=object(),
            property="name",
        )

        self.assertEqual(result.status, "error")
        self.assertEqual(result.detail, "RuntimeError: region is no longer active")

    def test_malformed_coordinates_are_error_not_false_exact_target(self) -> None:
        for native_result in ((1,), (1, 2, 3), (1.5, 2), (True, 2), object()):
            with self.subTest(native_result=native_result):
                result = module.try_activate_native_rna_button(
                    _WindowManager(native_result),
                    region=object(),
                    data=object(),
                    property="location",
                )

                self.assertEqual(result.status, "error")
                self.assertIsNone(result.window_xy)

    def test_exact_badge_is_bound_to_region_leaf_cursor_and_focused_operation(self) -> None:
        region = SimpleNamespace(
            x=100,
            y=50,
            width=400,
            height=300,
            as_pointer=lambda: 9123,
            view2d=_View2D(),
        )
        node, socket = _layout_target()
        result = module.NativeRnaTargetResult(
            status="exact_native",
            window_xy=(220, 170),
        )
        snapshot = SimpleNamespace(
            step_id="geometry-step",
            cursor_token="cursor-1",
            focused_ordinal=5,
            focused_operation=SimpleNamespace(operation_id="translation"),
        )

        remembered = module.remember_native_rna_badge(
            result,
            region=region,
            step_id="geometry-step",
            operation_id="translation",
            ordinal=5,
            cursor_token="cursor-1",
            component_index=0,
            target_node=node,
            target_data=socket,
        )

        self.assertTrue(remembered)
        self.assertEqual(
            module.native_rna_badge_region_point(region, snapshot),
            (120.0, 120.0),
        )
        snapshot.cursor_token = "stale"
        self.assertIsNone(module.native_rna_badge_region_point(region, snapshot))

    def test_badge_fails_closed_outside_bound_region_or_visible_bounds(self) -> None:
        region = SimpleNamespace(
            x=100,
            y=50,
            width=50,
            height=50,
            as_pointer=lambda: 111,
            view2d=_View2D(),
        )
        node, socket = _layout_target()
        snapshot = SimpleNamespace(
            step_id="step",
            cursor_token="cursor",
            focused_ordinal=2,
            focused_operation=SimpleNamespace(operation_id="operation"),
        )
        self.assertTrue(
            module.remember_native_rna_badge(
                module.NativeRnaTargetResult(
                    status="exact_native",
                    window_xy=(500, 500),
                ),
                region=region,
                step_id="step",
                operation_id="operation",
                ordinal=2,
                cursor_token="cursor",
                component_index=1,
                target_node=node,
                target_data=socket,
            )
        )

        self.assertIsNone(module.native_rna_badge_region_point(region, snapshot))
        other_region = SimpleNamespace(
            x=0,
            y=0,
            width=1000,
            height=1000,
            as_pointer=lambda: 222,
        )
        self.assertIsNone(
            module.native_rna_badge_region_point(other_region, snapshot)
        )

    def test_badge_expires_and_invalidates_on_same_region_layout_changes(self) -> None:
        original_monotonic = module.monotonic
        now = [100.0]
        module.monotonic = lambda: now[0]
        try:
            region = SimpleNamespace(
                x=100,
                y=50,
                width=400,
                height=300,
                as_pointer=lambda: 333,
                view2d=_View2D(),
            )
            node, socket = _layout_target()
            snapshot = SimpleNamespace(
                step_id="step",
                cursor_token="cursor",
                focused_ordinal=5,
                focused_operation=SimpleNamespace(operation_id="translation"),
            )
            result = module.NativeRnaTargetResult(
                status="exact_native",
                window_xy=(220, 170),
            )

            def remember() -> None:
                self.assertTrue(
                    module.remember_native_rna_badge(
                        result,
                        region=region,
                        step_id="step",
                        operation_id="translation",
                        ordinal=5,
                        cursor_token="cursor",
                        component_index=0,
                        target_node=node,
                        target_data=socket,
                    )
                )

            remember()
            region.view2d.offset_x = 1.0
            self.assertIsNone(module.native_rna_badge_region_point(region, snapshot))

            region.view2d.offset_x = 0.0
            remember()
            node.location_absolute[0] = 11.0
            self.assertIsNone(module.native_rna_badge_region_point(region, snapshot))

            node.location_absolute[0] = 10.0
            remember()
            region.width = 401
            self.assertIsNone(module.native_rna_badge_region_point(region, snapshot))

            region.width = 400
            remember()
            now[0] += module.NATIVE_RNA_BADGE_TTL_SECONDS + 0.01
            self.assertIsNone(module.native_rna_badge_region_point(region, snapshot))
        finally:
            module.monotonic = original_monotonic


if __name__ == "__main__":
    unittest.main()
