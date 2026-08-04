"""Launch-time visual smoke capture for the Blender companion.

Run with a non-background Blender process. The script captures the real 3D View
after the extension has registered its sidebar and POST_PIXEL overlay, then exits.
"""

import importlib.util
import os
import sys
from pathlib import Path

import bpy

sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
OUTPUT = REPO_ROOT / "artifacts" / "blender" / "overlay-smoke.png"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location(
    "operating_line_visual_smoke",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
extension = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extension
spec.loader.exec_module(extension)

extension.register()
factory_objects = {
    name: bpy.data.objects.get(name) for name in ("Cube", "Camera", "Light")
}
assert all(factory_objects.values())
factory_pointers = {
    name: obj.as_pointer() for name, obj in factory_objects.items()
}
assert bpy.ops.operating_line.start() == {"FINISHED"}
for name, obj in factory_objects.items():
    assert bpy.data.objects.get(name) is obj
    assert obj.as_pointer() == factory_pointers[name]
session = extension.get_session()
for _step in session.steps:
    assert bpy.ops.operating_line.next() == {"FINISHED"}
assert len(session.receipts) == len(session.steps) == 13
render_scene = bpy.data.scenes.get("OperatingLine.Scene.Snowman")
assert render_scene is not None
assert factory_objects["Cube"] not in tuple(render_scene.objects)
if bpy.context.window is not None:
    bpy.context.window.scene = render_scene


def prepare_view():
    panel_type = getattr(bpy.types, "OPERATINGLINE_PT_sidebar", None)
    assert panel_type is not None
    assert panel_type.bl_space_type == "VIEW_3D"
    assert panel_type.bl_region_type == "UI"
    assert panel_type.bl_category == "OperatingLine"
    for area in bpy.context.screen.areas:
        if area.type != "VIEW_3D":
            continue
        space = area.spaces.active
        space.show_region_ui = True
        space.region_3d.view_perspective = "CAMERA"
        space.shading.type = "RENDERED"
        area.tag_redraw()
        window_region = next(region for region in area.regions if region.type == "WINDOW")
        with bpy.context.temp_override(area=area, region=window_region, space_data=space):
            result = bpy.ops.wm.call_panel(
                "INVOKE_DEFAULT",
                name="OPERATINGLINE_PT_sidebar",
                keep_open=True,
            )
        print(f"OperatingLine panel invocation result: {sorted(result)}", flush=True)
        assert result in ({"INTERFACE"}, {"RUNNING_MODAL"})
    bpy.app.timers.register(force_draw_and_swap, first_interval=1.0)
    return None


def force_draw_and_swap():
    bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=1)
    hold_seconds = float(os.environ.get("OPERATINGLINE_VISUAL_HOLD_SECONDS", "0"))
    if hold_seconds > 0:
        print("OperatingLine visual smoke ready for OS capture", flush=True)
        bpy.app.timers.register(cleanup_and_quit, first_interval=hold_seconds)
        return None
    bpy.app.timers.register(capture_and_quit, first_interval=0.25)
    return None


def capture_and_quit():
    bpy.ops.screen.screenshot(filepath=str(OUTPUT))
    print(f"OperatingLine visual smoke captured: {OUTPUT}")
    bpy.app.timers.register(cleanup_and_quit, first_interval=0.75)
    return None


def cleanup_and_quit():
    extension.unregister()
    bpy.ops.wm.quit_blender()
    return None


bpy.app.timers.register(prepare_view, first_interval=0.5)
