"""Capture one isolated Blender guidance state for visual acceptance.

The Node launcher runs this script in a fresh Blender process for each state so
the real Panel popover is drawn from current data without stacked UI snapshots.
"""

import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path
import uuid

import bpy
from mathutils import Quaternion, Vector
import numpy as np

sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
OUTPUT_DIRECTORY = REPO_ROOT / "artifacts" / "blender"
OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
STATE = os.environ.get("OPERATINGLINE_VISUAL_STATE", "forward")
OUTPUT_NAMES = {
    "initial": "guidance-initial.png",
    "revision": "guidance-revision-request.png",
    "proposal": "guidance-proposal-review.png",
    "forward": "guidance-mid-forward.png",
    "back": "guidance-after-back.png",
    "hidden": "guidance-hidden.png",
    "operator": "guidance-operator-fallback.png",
}
if STATE not in OUTPUT_NAMES:
    raise ValueError(f"Unknown visual capture state: {STATE}")
OUTPUT = OUTPUT_DIRECTORY / OUTPUT_NAMES[STATE]
SMOKE_OUTPUT = OUTPUT_DIRECTORY / "overlay-smoke.png"

spec = importlib.util.spec_from_file_location(
    "operating_line_visual_smoke",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
extension = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extension
spec.loader.exec_module(extension)

from operating_line_visual_smoke.operating_line.application import (  # noqa: E402
    GuidanceState,
)
from operating_line_visual_smoke.operating_line.infrastructure.overlay import (  # noqa: E402
    _semantic_hint,
)
from operating_line_visual_smoke.operating_line.visual_theme import (  # noqa: E402
    color_for,
)

extension.register()
factory_objects = {
    name: bpy.data.objects.get(name) for name in ("Cube", "Camera", "Light")
}
assert all(factory_objects.values())
factory_pointers = {name: obj.as_pointer() for name, obj in factory_objects.items()}
assert bpy.ops.operating_line.start() == {"FINISHED"}
session = extension.get_session()
assert session.active_index == -1


def assert_factory_objects_preserved():
    for name, obj in factory_objects.items():
        assert bpy.data.objects.get(name) is obj
        assert obj.as_pointer() == factory_pointers[name]


def view3d_context():
    for area in bpy.context.screen.areas:
        if area.type != "VIEW_3D":
            continue
        space = area.spaces.active
        region = next(item for item in area.regions if item.type == "WINDOW")
        return area, region, space
    raise AssertionError("No VIEW_3D area available for visual capture")


def configure_state():
    if STATE == "initial":
        assert session.active_index == -1
    elif STATE == "revision":
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        bpy.context.window_manager.operating_line_revision_message += (
            "Make this head slightly larger and rougher"
        )
        assert extension.get_companion().revision_reference_scope == "active"
    elif STATE == "proposal":
        plan_path = (
            ADAPTER_ROOT / "operating_line" / "resources" / "snowman.plan.json"
        )
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        plan["id"] = "snowman-visual-proposal"
        plan["revision"] += 100
        plan["title"] = "AI proposal: create a reviewed snowman"
        plan["steps"][0]["title"] = plan["title"]
        accepted_session = extension.get_session()
        assert extension.get_companion().stage_proposal(
            {
                "protocolVersion": "1.0.0",
                "proposalId": str(uuid.uuid4()),
                "targetAdapterId": "blender",
                "plan": plan,
                "proposedAt": "2026-08-04T12:00:00Z",
            }
        )
        assert extension.get_session() is accepted_session
        assert extension.get_companion().proposal_session is not None
        assert not session.receipts
    elif STATE == "forward":
        for _ in range(9):
            assert bpy.ops.operating_line.next() == {"FINISHED"}
        assert session.active_index == 8
        assert len(session.receipts) == 9
    elif STATE in {"back", "hidden"}:
        for _ in range(9):
            assert bpy.ops.operating_line.next() == {"FINISHED"}
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        assert session.active_index == 7
        assert len(session.receipts) == 8
        if STATE == "hidden":
            assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
            assert bpy.context.window_manager.operating_line_overlay_enabled is False
    elif STATE == "operator":
        while session.active_index < 11:
            assert bpy.ops.operating_line.next() == {"FINISHED"}
        next_step = session.steps[session.active_index + 1]
        assert next_step.id == "snowman.render.preview"
        assert _semantic_hint(next_step) == (
            "UI target unavailable | Reference: Render > Render Image"
        )
        render_scene = bpy.data.scenes.get("OperatingLine.Scene.Snowman")
        assert render_scene is not None
        assert factory_objects["Cube"] not in tuple(render_scene.objects)
        if bpy.context.window is not None:
            bpy.context.window.scene = render_scene
    assert_factory_objects_preserved()


def prepare_view():
    panel_type = getattr(bpy.types, "OPERATINGLINE_PT_sidebar", None)
    assert panel_type is not None
    assert panel_type.bl_space_type == "VIEW_3D"
    assert panel_type.bl_region_type == "UI"
    assert panel_type.bl_category == "OperatingLine"

    area, region, space = view3d_context()
    space.show_region_ui = True
    space.shading.type = "MATERIAL"
    space.overlay.show_relationship_lines = False
    space.overlay.show_extras = False
    if STATE == "operator":
        space.region_3d.view_perspective = "CAMERA"
    else:
        space.region_3d.view_perspective = "PERSP"
        space.region_3d.view_location = Vector((0.0, 0.0, 3.0))
        space.region_3d.view_distance = 10.5
        space.region_3d.view_rotation = Quaternion((0.81, 0.37, 0.16, 0.42))

    bpy.context.window.cursor_warp(1320, 820)
    with bpy.context.temp_override(area=area, region=region, space_data=space):
        result = bpy.ops.wm.call_panel(
            "EXEC_DEFAULT",
            name="OPERATINGLINE_PT_sidebar",
            keep_open=True,
        )
    print(f"OperatingLine panel invocation result: {sorted(result)}", flush=True)
    assert result in ({"INTERFACE"}, {"RUNNING_MODAL"})
    bpy.context.window.cursor_warp(1100, 500)
    bpy.app.timers.register(capture_and_quit, first_interval=0.75)
    return None


def capture_and_quit():
    bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=1)
    bpy.ops.screen.screenshot(filepath=str(OUTPUT))
    assert OUTPUT.is_file() and OUTPUT.stat().st_size > 10_000
    assert_guidance_pixels()
    if STATE == "forward":
        shutil.copyfile(OUTPUT, SMOKE_OUTPUT)
    print(f"OperatingLine visual state captured: {OUTPUT.name}", flush=True)

    if STATE == "hidden":
        assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
        assert bpy.context.window_manager.operating_line_overlay_enabled is True
    hold_seconds = float(os.environ.get("OPERATINGLINE_VISUAL_HOLD_SECONDS", "0"))
    bpy.app.timers.register(cleanup_and_quit, first_interval=max(hold_seconds, 0.5))
    return None


def assert_guidance_pixels():
    """Check the rendered state colors and operator no-fake-line fallback."""

    image = bpy.data.images.load(str(OUTPUT), check_existing=False)
    try:
        pixels = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(pixels)
        rgb = pixels.reshape((-1, 4))[:, :3]
        ratios = {}
        for state in (
            GuidanceState.COMPLETED,
            GuidanceState.BACK,
            GuidanceState.NEXT,
            GuidanceState.LOCKED,
        ):
            target = np.asarray(color_for(state)[:3], dtype=np.float32)
            matches = np.max(np.abs(rgb - target), axis=1) < 0.02
            ratios[state] = float(np.count_nonzero(matches)) / len(rgb)
    finally:
        bpy.data.images.remove(image)

    completed = ratios[GuidanceState.COMPLETED]
    back = ratios[GuidanceState.BACK]
    next_step = ratios[GuidanceState.NEXT]
    locked = ratios[GuidanceState.LOCKED]
    print(
        "OperatingLine visual color ratios: "
        f"completed={completed:.6f}, back={back:.6f}, "
        f"next={next_step:.6f}, locked={locked:.6f}",
        flush=True,
    )

    if STATE in {"initial", "revision", "proposal"}:
        assert next_step > 0.0003
        assert locked > 0.0001
        assert completed < 0.00003 and back < 0.00003
    elif STATE in {"forward", "back"}:
        assert completed > 0.00005
        assert back > 0.0003
        assert next_step > 0.0003
    elif STATE == "hidden":
        assert max(completed, back, next_step) < 0.00003
    elif STATE == "operator":
        assert completed > 0.00005
        assert 0.00005 < back < 0.0003
        assert 0.00005 < next_step < 0.0003


def cleanup_and_quit():
    extension.unregister()
    bpy.ops.wm.quit_blender()
    return None


configure_state()
bpy.app.timers.register(prepare_view, first_interval=0.5)
