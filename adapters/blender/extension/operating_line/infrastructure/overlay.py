"""POST_PIXEL viewport guidance overlay using Blender public drawing APIs."""

import blf
import bpy
import gpu
from bpy_extras import view3d_utils
from gpu_extras.batch import batch_for_shader

from .snowman_actions import (
    build_resource_registry,
    resolve_receipt_anchor,
    resolve_resource,
)

_draw_handle = None
_session_provider = None


def overlay_enabled() -> bool:
    return _draw_handle is not None


def enable_overlay(session_provider) -> None:
    global _draw_handle, _session_provider
    _session_provider = session_provider
    if _draw_handle is None:
        _draw_handle = bpy.types.SpaceView3D.draw_handler_add(
            _draw_overlay, (), "WINDOW", "POST_PIXEL"
        )
    _tag_redraw()


def disable_overlay() -> None:
    global _draw_handle, _session_provider
    if _draw_handle is not None:
        bpy.types.SpaceView3D.draw_handler_remove(_draw_handle, "WINDOW")
        _draw_handle = None
    _session_provider = None
    _tag_redraw()


def _tag_redraw() -> None:
    window_manager = getattr(bpy.context, "window_manager", None)
    if window_manager is None:
        return
    for window in window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


def _anchor(region, region_3d, session):
    step = session.active_step
    if step is None:
        return None
    registry = build_resource_registry(session.receipts)
    for anchor in step.anchors:
        kind = anchor.get("kind")
        if kind == "object":
            object_name = anchor.get("objectName")
            for identity in registry.values():
                if identity.resource_type != "OBJECT" or identity.display_name != object_name:
                    continue
                obj = resolve_resource(identity)
                if isinstance(obj, bpy.types.Object):
                    return view3d_utils.location_3d_to_region_2d(
                        region, region_3d, obj.matrix_world.translation
                    )
        elif kind == "world_position":
            position = anchor.get("position")
            if (
                isinstance(position, list)
                and len(position) == 3
                and all(
                    isinstance(value, (int, float)) and not isinstance(value, bool)
                    for value in position
                )
            ):
                return view3d_utils.location_3d_to_region_2d(
                    region, region_3d, tuple(float(value) for value in position)
                )
    receipt = session.receipts.get(step.id)
    obj = resolve_receipt_anchor(receipt) if receipt is not None else None
    if obj is None:
        return None
    return view3d_utils.location_3d_to_region_2d(
        region, region_3d, obj.matrix_world.translation
    )


def _draw_overlay() -> None:
    if _session_provider is None:
        return
    session = _session_provider()
    step = session.active_step
    if step is None:
        return
    context = bpy.context
    region = context.region
    space = context.space_data
    if region is None or not isinstance(space, bpy.types.SpaceView3D):
        return

    width, height = 300.0, 72.0
    left, bottom = 24.0, 52.0
    top = bottom + height
    shader = gpu.shader.from_builtin("UNIFORM_COLOR")
    card = batch_for_shader(
        shader,
        "TRIS",
        {
            "pos": (
                (left, bottom),
                (left + width, bottom),
                (left + width, top),
                (left, top),
            )
        },
        indices=((0, 1, 2), (0, 2, 3)),
    )

    gpu.state.blend_set("ALPHA")
    try:
        shader.bind()
        shader.uniform_float("color", (0.035, 0.045, 0.065, 0.88))
        card.draw(shader)

        anchor = _anchor(region, space.region_3d, session)
        if anchor is not None:
            line = batch_for_shader(
                shader,
                "LINES",
                {"pos": ((left + width, bottom + height * 0.5), tuple(anchor))},
            )
            shader.uniform_float("color", (0.35, 0.75, 1.0, 0.9))
            gpu.state.line_width_set(2.0)
            line.draw(shader)
            gpu.state.line_width_set(1.0)

        font_id = 0
        blf.color(font_id, 0.45, 0.82, 1.0, 1.0)
        blf.size(font_id, 14)
        blf.position(font_id, left + 16, top - 26, 0)
        blf.draw(font_id, f"STEP {session.active_index + 1} / {len(session.steps)}")
        blf.color(font_id, 1.0, 1.0, 1.0, 1.0)
        blf.size(font_id, 17)
        blf.position(font_id, left + 16, bottom + 16, 0)
        blf.draw(font_id, step.title)
    finally:
        gpu.state.line_width_set(1.0)
        gpu.state.blend_set("NONE")
