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
assert all(bpy.data.objects.get(name) is None for name in ("Cube", "Camera", "Light"))
assert bpy.ops.operating_line.start() == {"FINISHED"}
assert all(bpy.data.objects.get(name) is None for name in ("Cube", "Camera", "Light"))
assert bpy.ops.operating_line.next() == {"FINISHED"}


def prepare_view():
    for area in bpy.context.screen.areas:
        if area.type != "VIEW_3D":
            continue
        space = area.spaces.active
        space.show_region_ui = True
        space.region_3d.view_location = (0.0, 0.0, 2.7)
        space.region_3d.view_distance = 8.0
        area.tag_redraw()
    bpy.app.timers.register(force_draw_and_swap, first_interval=0.5)
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
