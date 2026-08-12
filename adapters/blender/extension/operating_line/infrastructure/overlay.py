"""State-aware POST_PIXEL viewport guidance using Blender public APIs."""

from math import cos, hypot, pi, sin

import blf
import bpy
import gpu
from bpy_extras import view3d_utils
from gpu_extras.batch import batch_for_shader

from ..application import GuidanceState, GuidanceStep, relevant_steps, step_state
from ..visual_theme import HALO, MUTED_TEXT, SURFACE, TEXT, color_for
from .snowman_actions import (
    build_resource_registry,
    resolve_receipt_anchor,
    resolve_resource,
)

_draw_handle = None
_session_provider = None
_menu_guidance_provider = None


def overlay_enabled() -> bool:
    return _draw_handle is not None


def enable_overlay(session_provider, menu_guidance_provider=None) -> None:
    """Register one viewport handler; the invoking UI event schedules redraw."""

    global _draw_handle, _session_provider, _menu_guidance_provider
    _session_provider = session_provider
    _menu_guidance_provider = menu_guidance_provider
    if _draw_handle is None:
        _draw_handle = bpy.types.SpaceView3D.draw_handler_add(
            _draw_overlay, (), "WINDOW", "POST_PIXEL"
        )


def disable_overlay() -> None:
    """Remove the viewport handler without calling unavailable Area redraw APIs."""

    global _draw_handle, _session_provider, _menu_guidance_provider
    if _draw_handle is not None:
        bpy.types.SpaceView3D.draw_handler_remove(_draw_handle, "WINDOW")
        _draw_handle = None
    _session_provider = None
    _menu_guidance_provider = None


def _screen_anchor(region, region_3d, session, step):
    registry = build_resource_registry(session.receipts)
    has_semantic_only_anchor = False
    for anchor in step.anchors:
        kind = anchor.get("kind")
        if kind == "object":
            object_name = anchor.get("objectName")
            for identity in registry.values():
                if (
                    identity.resource_type != "OBJECT"
                    or identity.display_name != object_name
                ):
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
        elif kind in {"operator", "owned_control", "unavailable"}:
            has_semantic_only_anchor = True

    if has_semantic_only_anchor:
        return None

    receipt = session.receipts.get(step.id)
    obj = resolve_receipt_anchor(receipt) if receipt is not None else None
    if obj is None:
        return None
    return view3d_utils.location_3d_to_region_2d(
        region, region_3d, obj.matrix_world.translation
    )


def _semantic_hint(step) -> str | None:
    for anchor in step.anchors:
        if anchor.get("kind") != "operator":
            continue
        menu_path = anchor.get("menuPath")
        if isinstance(menu_path, list) and menu_path:
            return "UI target unavailable | Reference: " + " > ".join(
                str(item) for item in menu_path
            )
        operator_id = anchor.get("operatorId")
        if isinstance(operator_id, str) and operator_id:
            return f"Action: {operator_id} (UI target unavailable)"
    return None


def _context_steps(session, limit: int = 4) -> tuple[GuidanceStep, ...]:
    """Keep the execution neighborhood visible, including locked look-ahead."""

    relevant = relevant_steps(session, limit=limit)
    if len(relevant) >= limit or len(session.steps) <= len(relevant):
        return relevant
    indices = [item.index for item in relevant]
    next_index = indices[-1] + 1 if indices else 0
    while len(indices) < limit and next_index < len(session.steps):
        indices.append(next_index)
        next_index += 1
    return tuple(
        GuidanceStep(session.steps[index], index, step_state(session, index))
        for index in indices
    )


def _draw_triangles(shader, positions, indices, color) -> None:
    batch = batch_for_shader(
        shader,
        "TRIS",
        {"pos": tuple(positions)},
        indices=tuple(indices),
    )
    shader.bind()
    shader.uniform_float("color", color)
    batch.draw(shader)


def _draw_rect(shader, left, bottom, right, top, color) -> None:
    _draw_triangles(
        shader,
        ((left, bottom), (right, bottom), (right, top), (left, top)),
        ((0, 1, 2), (0, 2, 3)),
        color,
    )


def _draw_circle(shader, center, radius, color, segments: int = 28) -> None:
    positions = [center]
    positions.extend(
        (
            center[0] + cos(index * 2.0 * pi / segments) * radius,
            center[1] + sin(index * 2.0 * pi / segments) * radius,
        )
        for index in range(segments)
    )
    indices = [
        (0, index + 1, (index + 1) % segments + 1) for index in range(segments)
    ]
    _draw_triangles(shader, positions, indices, color)


def _draw_segment(shader, start, end, width, color) -> None:
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = hypot(dx, dy)
    if length < 0.001:
        return
    offset_x = -dy / length * width * 0.5
    offset_y = dx / length * width * 0.5
    positions = (
        (start[0] + offset_x, start[1] + offset_y),
        (start[0] - offset_x, start[1] - offset_y),
        (end[0] - offset_x, end[1] - offset_y),
        (end[0] + offset_x, end[1] + offset_y),
    )
    _draw_triangles(shader, positions, ((0, 1, 2), (0, 2, 3)), color)


def _draw_arrow(shader, start, end, color) -> None:
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = hypot(dx, dy)
    if length < 0.001:
        return
    unit_x, unit_y = dx / length, dy / length
    normal_x, normal_y = -unit_y, unit_x
    base = (end[0] - unit_x * 14.0, end[1] - unit_y * 14.0)
    points = (
        end,
        (base[0] + normal_x * 7.0, base[1] + normal_y * 7.0),
        (base[0] - normal_x * 7.0, base[1] - normal_y * 7.0),
    )
    _draw_triangles(shader, points, ((0, 1, 2),), color)


def _draw_guide_line(shader, start, end, color) -> None:
    _draw_segment(shader, start, end, 10.0, HALO)
    _draw_segment(shader, start, end, 4.0, color)
    _draw_arrow(shader, start, end, HALO)
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = hypot(dx, dy)
    if length > 0.001:
        inset_end = (end[0] - dx / length * 2.0, end[1] - dy / length * 2.0)
        _draw_arrow(shader, start, inset_end, color)


def _draw_text(text, position, size, color) -> None:
    font_id = 0
    blf.color(font_id, *color)
    blf.size(font_id, size)
    blf.position(font_id, position[0], position[1], 0)
    blf.draw(font_id, text)


def _draw_centered_text(text, center, size, color) -> None:
    font_id = 0
    blf.size(font_id, size)
    width, height = blf.dimensions(font_id, text)
    _draw_text(
        text,
        (center[0] - width * 0.5, center[1] - height * 0.38),
        size,
        color,
    )


def _clamp_anchor(anchor, region, margin: float = 20.0):
    return (
        max(margin, min(float(region.width) - margin, float(anchor[0]))),
        max(margin, min(float(region.height) - margin, float(anchor[1]))),
    )


def _draw_badge(
    shader,
    center,
    ordinal,
    state,
    *,
    radius: float = 17.0,
    text_size: int = 13,
) -> None:
    color = color_for(state)
    _draw_circle(shader, center, radius, HALO)
    _draw_circle(shader, center, max(radius - 3.0, 1.0), color)
    number_color = HALO if state is not GuidanceState.LOCKED else TEXT
    _draw_centered_text(f"{ordinal:02d}", center, text_size, number_color)


def _draw_overlay() -> None:
    if _session_provider is None:
        return
    session = _session_provider()
    items = _context_steps(session)
    if not items:
        return

    context = bpy.context
    region = context.region
    space = context.space_data
    if region is None or not isinstance(space, bpy.types.SpaceView3D):
        return

    menu_guidance = (
        _menu_guidance_provider()
        if _menu_guidance_provider is not None
        else None
    )
    card_width = min(600.0, max(390.0, float(region.width) - 48.0))
    card_height = 284.0 if menu_guidance is not None else 210.0
    left, bottom = 24.0, 44.0
    right, top = left + card_width, bottom + card_height
    badge_y = top - 72.0
    available_width = card_width - 64.0
    spacing = min(92.0, available_width / max(len(items), 1))
    first_x = left + 36.0
    badge_centers = {
        item.index: (first_x + item_index * spacing, badge_y)
        for item_index, item in enumerate(items)
    }
    active = session.active_step
    next_index = session.active_index + 1
    next_step = session.steps[next_index] if next_index < len(session.steps) else None
    guide_targets = []
    for step, index, state in (
        (active, session.active_index, GuidanceState.BACK),
        (
            next_step,
            next_index,
            step_state(session, next_index)
            if next_step is not None
            else GuidanceState.LOCKED,
        ),
    ):
        if step is None or index not in badge_centers:
            continue
        anchor = _screen_anchor(region, space.region_3d, session, step)
        if anchor is None:
            continue
        exact_target = _clamp_anchor(anchor, region)
        guide_targets.append([index, state, exact_target, exact_target])

    if len(guide_targets) == 2:
        first_target = guide_targets[0][2]
        second_target = guide_targets[1][2]
        if hypot(
            second_target[0] - first_target[0],
            second_target[1] - first_target[1],
        ) < 44.0:
            guide_targets[0][3] = _clamp_anchor(
                (first_target[0] - 22.0, first_target[1]), region
            )
            guide_targets[1][3] = _clamp_anchor(
                (second_target[0] + 22.0, second_target[1]), region
            )
    shader = gpu.shader.from_builtin("UNIFORM_COLOR")

    gpu.state.blend_set("ALPHA")
    try:
        # Lines are painted first so the card masks their origin and its numbers
        # remain legible. Endpoint badges stay above the colored line.
        for index, state, exact_target, endpoint in guide_targets:
            start = badge_centers[index]
            _draw_guide_line(shader, start, endpoint, color_for(state))
            if endpoint != exact_target:
                _draw_segment(shader, endpoint, exact_target, 7.0, HALO)
                _draw_segment(shader, endpoint, exact_target, 3.0, color_for(state))
                _draw_circle(shader, exact_target, 4.0, HALO)
                _draw_circle(shader, exact_target, 2.0, color_for(state))
            _draw_badge(shader, endpoint, index + 1, state)

        _draw_rect(shader, left - 2.0, bottom - 2.0, right + 2.0, top + 2.0, HALO)
        _draw_rect(shader, left, bottom, right, top, SURFACE)

        _draw_text(
            f"GUIDANCE  {session.active_index + 1:02d} / {len(session.steps):02d}",
            (left + 20.0, top - 32.0),
            18,
            TEXT,
        )

        for item_index, item in enumerate(items):
            center = badge_centers[item.index]
            if item_index:
                previous = items[item_index - 1]
                previous_center = badge_centers[previous.index]
                connector_color = color_for(item.state)
                _draw_segment(
                    shader,
                    (previous_center[0] + 20.0, badge_y),
                    (center[0] - 20.0, badge_y),
                    8.0,
                    HALO,
                )
                _draw_segment(
                    shader,
                    (previous_center[0] + 20.0, badge_y),
                    (center[0] - 20.0, badge_y),
                    4.0,
                    connector_color,
                )
            _draw_badge(
                shader,
                center,
                item.index + 1,
                item.state,
                radius=22.0,
                text_size=16,
            )

        back_text = (
            f"BACK {session.active_index + 1:02d}  {active.title}"
            if active is not None
            else "BACK --  Nothing to roll back"
        )
        next_text = (
            f"NEXT {next_index + 1:02d}  Locked by observation gate"
            if next_step is not None and session.observation_blocked
            else f"NEXT {next_index + 1:02d}  {next_step.title}"
            if next_step is not None
            else "NEXT --  Walkthrough complete"
        )
        back_y = bottom + (142.0 if menu_guidance is not None else 62.0)
        next_y = bottom + (116.0 if menu_guidance is not None else 36.0)
        semantic_y = bottom + (94.0 if menu_guidance is not None else 14.0)
        _draw_text(
            back_text,
            (left + 20.0, back_y),
            15,
            color_for(GuidanceState.BACK) if active is not None else MUTED_TEXT,
        )
        _draw_text(
            next_text,
            (left + 20.0, next_y),
            15,
            color_for(step_state(session, next_index))
            if next_step is not None
            else MUTED_TEXT,
        )

        semantic_step = next_step or active
        semantic_hint = _semantic_hint(semantic_step) if semantic_step is not None else None
        if menu_guidance is not None:
            path_status = (
                f"MENU PATH  Click green {menu_guidance.items[-1].ordinal:02d} or use Next"
                if menu_guidance.native
                else "REFERENCE PATH  UI target unavailable · use Next"
            )
            _draw_text(
                path_status,
                (left + 20.0, semantic_y),
                12,
                TEXT if menu_guidance.native else MUTED_TEXT,
            )
            path_left = left + 66.0
            path_right = right - 66.0
            path_spacing = (path_right - path_left) / max(
                len(menu_guidance.items) - 1,
                1,
            )
            path_y = bottom + 43.0
            path_centers = [
                (path_left + index * path_spacing, path_y)
                for index in range(len(menu_guidance.items))
            ]
            for item_index, item in enumerate(menu_guidance.items):
                center = path_centers[item_index]
                if item_index:
                    previous_center = path_centers[item_index - 1]
                    _draw_segment(
                        shader,
                        (previous_center[0] + 15.0, path_y),
                        (center[0] - 15.0, path_y),
                        7.0,
                        HALO,
                    )
                    _draw_segment(
                        shader,
                        (previous_center[0] + 15.0, path_y),
                        (center[0] - 15.0, path_y),
                        3.0,
                        color_for(item.state),
                    )
                _draw_badge(
                    shader,
                    center,
                    item.ordinal,
                    item.state,
                    radius=16.0,
                    text_size=12,
                )
                _draw_centered_text(
                    item.label,
                    (center[0], bottom + 15.0),
                    11,
                    TEXT,
                )
        elif semantic_hint is not None:
            _draw_text(
                semantic_hint,
                (left + 20.0, semantic_y),
                12,
                MUTED_TEXT,
            )
    finally:
        gpu.state.blend_set("NONE")
