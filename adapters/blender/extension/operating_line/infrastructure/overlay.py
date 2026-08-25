"""State-aware POST_PIXEL guidance using Blender public APIs."""

from dataclasses import dataclass
from math import cos, hypot, isfinite, pi, sin

import blf
import bpy
import gpu
from bpy_extras import view3d_utils
from gpu_extras.batch import batch_for_shader

from ..application import GuidanceState, GuidanceStep, relevant_steps, step_state
from ..visual_theme import HALO, MUTED_TEXT, SURFACE, TEXT, color_for
from .native_rna_targeting import (
    clear_native_rna_badge,
    native_rna_badge_region_point,
)
from .snowman_actions import (
    build_resource_registry,
    resolve_receipt_anchor,
    resolve_resource,
)

_view3d_draw_handle = None
_node_editor_draw_handle = None
_session_provider = None
_menu_guidance_provider = None

_RECEIPT_BOUND_GEOMETRY_NODE_RECIPES = {
    "blender.geometry_nodes.create_transform.semantic": (
        "blender.geometry_nodes.create_transform"
    ),
    "blender.geometry_nodes.create_light_trails.semantic": (
        "blender.geometry_nodes.create_light_trails"
    ),
}
_NODE_NAME_TARGET_PREFIX = "node-name:"


@dataclass(frozen=True, slots=True)
class NodeEditorMarker:
    """One frame-local exact node rectangle bound to a leaf operation."""

    operation_id: str
    ordinal: int
    label: str
    state: object
    node: object
    bounds: tuple[float, float, float, float]
    badge_center: tuple[float, float]
    reference: bool
    cursor_token: str


def overlay_enabled() -> bool:
    return _view3d_draw_handle is not None and _node_editor_draw_handle is not None


def enable_overlay(session_provider, menu_guidance_provider=None) -> None:
    """Atomically register the 3D and Node Editor guidance handlers."""

    global _view3d_draw_handle, _node_editor_draw_handle
    global _session_provider, _menu_guidance_provider
    if overlay_enabled():
        _session_provider = session_provider
        _menu_guidance_provider = menu_guidance_provider
        return
    if _view3d_draw_handle is not None or _node_editor_draw_handle is not None:
        disable_overlay()

    space_view3d = getattr(bpy.types, "SpaceView3D", None)
    space_node_editor = getattr(bpy.types, "SpaceNodeEditor", None)
    if space_view3d is None or space_node_editor is None:
        raise RuntimeError("Required Blender overlay space types are unavailable")

    _session_provider = None
    _menu_guidance_provider = None
    view3d_handle = space_view3d.draw_handler_add(
        _draw_overlay, (), "WINDOW", "POST_PIXEL"
    )
    _view3d_draw_handle = view3d_handle
    try:
        node_editor_handle = space_node_editor.draw_handler_add(
            _draw_node_overlay, (), "WINDOW", "POST_PIXEL"
        )
    except Exception as registration_error:
        try:
            space_view3d.draw_handler_remove(view3d_handle, "WINDOW")
        except Exception as rollback_error:
            combined_error = RuntimeError(
                "OperatingLine Node Editor overlay registration failed and its "
                "View3D rollback remains pending"
            )
            combined_error.add_note(
                f"Original Node Editor registration error: {registration_error!r}"
            )
            raise combined_error from rollback_error
        _view3d_draw_handle = None
        raise

    _node_editor_draw_handle = node_editor_handle
    _session_provider = session_provider
    _menu_guidance_provider = menu_guidance_provider


def disable_overlay() -> None:
    """Independently remove every tracked handler, allowing cleanup retries."""

    global _view3d_draw_handle, _node_editor_draw_handle
    global _session_provider, _menu_guidance_provider
    clear_native_rna_badge()
    if _view3d_draw_handle is None and _node_editor_draw_handle is None:
        _session_provider = None
        _menu_guidance_provider = None
        return

    failures: list[tuple[str, Exception]] = []
    if _node_editor_draw_handle is not None:
        try:
            bpy.types.SpaceNodeEditor.draw_handler_remove(
                _node_editor_draw_handle,
                "WINDOW",
            )
        except Exception as error:
            failures.append(("Node Editor", error))
        else:
            _node_editor_draw_handle = None
    if _view3d_draw_handle is not None:
        try:
            bpy.types.SpaceView3D.draw_handler_remove(
                _view3d_draw_handle,
                "WINDOW",
            )
        except Exception as error:
            failures.append(("View3D", error))
        else:
            _view3d_draw_handle = None

    if _view3d_draw_handle is None and _node_editor_draw_handle is None:
        _session_provider = None
        _menu_guidance_provider = None
    if failures:
        spaces = ", ".join(space for space, _error in failures)
        raise RuntimeError(
            f"OperatingLine overlay cleanup remains pending for: {spaces}"
        ) from failures[0][1]


def _screen_anchor(region, region_3d, session, step):
    registry = build_resource_registry(
        getattr(session, "managed_receipts", session.receipts)
    )
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

    receipt_lookup = getattr(session, "receipt_for_step", None)
    receipt = (
        receipt_lookup(step.id)
        if callable(receipt_lookup)
        else session.receipts.get(step.id)
    )
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


def _finite_pair(value) -> tuple[float, float] | None:
    try:
        x = float(value[0])
        y = float(value[1])
    except (IndexError, KeyError, TypeError, ValueError):
        return None
    if not isfinite(x) or not isfinite(y):
        return None
    return (x, y)


def _snapshot_binding(snapshot) -> tuple | None:
    """Return the complete frame-local identity used by exact UI markers."""

    focused = getattr(snapshot, "focused_operation", None)
    operations = _leaf_operations(snapshot)
    if focused is None or not operations:
        return None
    try:
        operation_binding = tuple(
            (operation.ordinal, operation.operation_id, operation.state)
            for operation in operations
        )
        return (
            snapshot.step_id,
            snapshot.recipe_id,
            snapshot.cursor_token,
            snapshot.focused_ordinal,
            focused.operation_id,
            snapshot.retry_serial,
            operation_binding,
        )
    except (AttributeError, TypeError, ValueError):
        return None


def _snapshot_is_current(snapshot) -> bool:
    """Reject cached or foreign snapshots before resolving a Blender target."""

    if _menu_guidance_provider is None:
        return False
    try:
        current = _menu_guidance_provider()
    except (RuntimeError, TypeError, ValueError):
        return False
    binding = _snapshot_binding(snapshot)
    return binding is not None and binding == _snapshot_binding(current)


def _receipt_bound_node_tree(session, snapshot, space):
    """Resolve an allowlisted current node tree through its managed receipt."""

    step = getattr(session, "guidance_step", None)
    expected_action_name = _RECEIPT_BOUND_GEOMETRY_NODE_RECIPES.get(
        getattr(snapshot, "recipe_id", None)
    )
    if (
        step is None
        or snapshot is None
        or not _snapshot_is_current(snapshot)
        or not isinstance(getattr(snapshot, "cursor_token", None), str)
        or not snapshot.cursor_token
        or snapshot.step_id != step.id
        or expected_action_name is None
    ):
        return None
    action = getattr(step, "action", None)
    if action is None or action.name != expected_action_name:
        return None
    arguments = getattr(action, "arguments", None)
    if not isinstance(arguments, dict):
        return None
    node_group_id = arguments.get("nodeGroupId")
    node_group_name = arguments.get("nodeGroupName")
    if not isinstance(node_group_id, str) or not isinstance(node_group_name, str):
        return None
    try:
        receipt_lookup = getattr(session, "receipt_for_step", None)
        receipt = (
            receipt_lookup(step.id)
            if callable(receipt_lookup)
            else session.receipts.get(step.id)
        )
        identities = tuple(
            identity
            for identity in receipt.created
            if identity.logical_id == node_group_id
        )
    except (AttributeError, KeyError, RuntimeError, TypeError, ValueError):
        return None
    if (
        receipt is None
        or receipt.step_id != step.id
        or receipt.action_name != action.name
        or len(identities) != 1
    ):
        return None
    identity = identities[0]
    if (
        identity.resource_type != "NODE_GROUP"
        or identity.display_name != node_group_name
        or identity.receipt_token != receipt.receipt_id
        or identity.step_id != step.id
        or identity.action_name != action.name
    ):
        return None
    try:
        node_tree = resolve_resource(identity)
    except (KeyError, RuntimeError, TypeError, ValueError):
        return None
    if (
        node_tree is None
        or node_tree is not getattr(space, "edit_tree", None)
        or getattr(node_tree, "name", None) != node_group_name
        or getattr(node_tree, "bl_idname", None) != "GeometryNodeTree"
    ):
        return None
    return node_tree


def _node_matches_target_id(node, target_id: str) -> bool:
    """Match either a node type or one explicit receipt-authored node name."""

    if target_id.startswith(_NODE_NAME_TARGET_PREFIX):
        expected_name = target_id.removeprefix(_NODE_NAME_TARGET_PREFIX)
        return bool(expected_name) and getattr(node, "name", None) == expected_name
    return getattr(node, "bl_idname", None) == target_id


def _node_screen_bounds(context, region, node) -> tuple[float, float, float, float] | None:
    """Map Blender's public absolute node rectangle into WINDOW pixels.

    Blender stores ``location_absolute`` in unscaled node coordinates, while
    ``dimensions`` is the evaluated display size.  Its own Node Editor draw
    path scales the location by ``UI_SCALE_FAC`` before applying ``View2D``.
    ``PreferencesSystem.ui_scale`` exposes that runtime factor to add-ons.
    """

    location = _finite_pair(getattr(node, "location_absolute", None))
    dimensions = _finite_pair(getattr(node, "dimensions", None))
    view2d = getattr(region, "view2d", None)
    node_type = getattr(node, "type", None)
    system_preferences = getattr(
        getattr(getattr(context, "preferences", None), "system", None),
        "ui_scale",
        None,
    )
    try:
        ui_scale = float(system_preferences)
    except (TypeError, ValueError):
        return None
    if (
        location is None
        or dimensions is None
        or dimensions[0] <= 0
        or dimensions[1] <= 0
        or not isfinite(ui_scale)
        or ui_scale <= 0
        or view2d is None
        or bool(getattr(node, "hide", False))
        or node_type in {"FRAME", "REROUTE"}
    ):
        return None
    scaled_location = (location[0] * ui_scale, location[1] * ui_scale)
    try:
        top_left = _finite_pair(
            view2d.view_to_region(
                scaled_location[0],
                scaled_location[1],
                clip=False,
            )
        )
        bottom_right = _finite_pair(
            view2d.view_to_region(
                scaled_location[0] + dimensions[0],
                scaled_location[1] - dimensions[1],
                clip=False,
            )
        )
    except (RuntimeError, TypeError, ValueError):
        return None
    if top_left is None or bottom_right is None:
        return None
    left = min(top_left[0], bottom_right[0])
    right = max(top_left[0], bottom_right[0])
    bottom = min(top_left[1], bottom_right[1])
    top = max(top_left[1], bottom_right[1])
    width = float(getattr(region, "width", 0.0))
    height = float(getattr(region, "height", 0.0))
    if (
        width <= 0
        or height <= 0
        or right <= 0
        or left >= width
        or top <= 0
        or bottom >= height
        or top > height
    ):
        return None
    visible_left = max(0.0, left)
    visible_right = min(width, right)
    visible_bottom = max(0.0, bottom)
    visible_top = min(height, top)
    if visible_right - visible_left < 36.0 or visible_top - visible_bottom < 24.0:
        return None
    return (visible_left, visible_bottom, visible_right, visible_top)


def _resolve_node_editor_markers(context, session, snapshot) -> tuple[NodeEditorMarker, ...]:
    """Resolve exact node frames without guessing sockets or built-in controls."""

    space_node_editor = getattr(bpy.types, "SpaceNodeEditor", None)
    space = getattr(context, "space_data", None)
    region = getattr(context, "region", None)
    if (
        space_node_editor is None
        or not isinstance(space, space_node_editor)
        or region is None
        or getattr(region, "type", "WINDOW") != "WINDOW"
    ):
        return ()
    node_tree = _receipt_bound_node_tree(session, snapshot, space)
    if node_tree is None:
        return ()
    operations = _leaf_operations(snapshot)
    try:
        nodes = tuple(node_tree.nodes)
    except (AttributeError, RuntimeError, TypeError):
        return ()

    markers: list[NodeEditorMarker] = []
    for operation in operations:
        if getattr(operation, "target_kind", None) != "node":
            continue
        target_id = getattr(operation, "target_id", None)
        if not isinstance(target_id, str):
            continue
        matches = tuple(
            node for node in nodes if _node_matches_target_id(node, target_id)
        )
        if len(matches) != 1:
            continue
        node = matches[0]
        bounds = _node_screen_bounds(context, region, node)
        if bounds is None:
            continue
        left, bottom, _right, top = bounds
        badge_center = (left + 18.0, max(bottom + 12.0, top - 18.0))
        markers.append(
            NodeEditorMarker(
                operation_id=operation.operation_id,
                ordinal=operation.ordinal,
                label=operation.label,
                state=operation.state,
                node=node,
                bounds=bounds,
                badge_center=badge_center,
                reference=bool(getattr(operation, "reference", True)),
                cursor_token=snapshot.cursor_token,
            )
        )
    return tuple(markers)


def _operation_connection_text(operation) -> str | None:
    connection = getattr(operation, "connection", None)
    if connection is None:
        return None
    return (
        f"{connection.from_node}.{connection.from_socket} -> "
        f"{connection.to_node}.{connection.to_socket}"
    )


def _marker_for_container(operation, markers) -> NodeEditorMarker | None:
    """Resolve one exact public node frame for a guided inner-node control."""

    container_target_id = getattr(operation, "container_target_id", None)
    if not isinstance(container_target_id, str) or not container_target_id:
        return None
    matches = tuple(
        marker
        for marker in markers
        if _node_matches_target_id(marker.node, container_target_id)
    )
    return matches[0] if len(matches) == 1 else None


def _connection_proxy_points(operation, markers):
    """Return exact node-frame anchors for a connection proxy, never socket pixels."""

    connection = getattr(operation, "connection", None)
    if connection is None:
        return None

    def unique_marker(node_target_id):
        matches = tuple(
            marker
            for marker in markers
            if _node_matches_target_id(marker.node, node_target_id)
        )
        return matches[0] if len(matches) == 1 else None

    source = unique_marker(connection.from_node)
    target = unique_marker(connection.to_node)
    if source is None or target is None or source is target:
        return None
    source_point = (
        source.bounds[2],
        (source.bounds[1] + source.bounds[3]) / 2.0,
    )
    target_point = (
        target.bounds[0],
        (target.bounds[1] + target.bounds[3]) / 2.0,
    )
    midpoint = (
        (source_point[0] + target_point[0]) / 2.0,
        (source_point[1] + target_point[1]) / 2.0,
    )
    return source_point, target_point, midpoint


def _node_target_status(
    operation,
    *,
    direct_marker,
    container_marker,
    connection_points,
) -> str:
    trust = getattr(operation, "target_trust", None)
    trust_value = getattr(trust, "value", trust)
    if trust_value == "exact_native":
        return (
            "EXACT NATIVE · target resolved"
            if direct_marker is not None
            else "EXACT NATIVE · target is not currently visible"
        )
    if trust_value == "guided_control":
        if connection_points is not None:
            return "GUIDED CONTROL · exact node containers; socket pixels unresolved"
        if container_marker is not None:
            return "GUIDED CONTROL · exact container; native value widget unresolved"
        return "GUIDED CONTROL · OperatingLine-owned proxy"
    if trust_value in {"container_capable", "container_exact"}:
        return (
            "CONTAINER EXACT · node frame resolved · UI interaction not observed"
            if direct_marker is not None
            else "CONTAINER CAPABLE · current receipt-bound node frame unresolved"
        )
    return (
        "NODE FRAME RESOLVED · REFERENCE ONLY · UI interaction not observed"
        if direct_marker is not None
        else "REFERENCE ONLY · exact UI target unavailable"
    )


def _focused_operation_detail(operation) -> str | None:
    parameter_text = _operation_parameter_text(operation)
    connection_text = _operation_connection_text(operation)
    return parameter_text or connection_text


def _draw_node_marker(shader, marker: NodeEditorMarker) -> None:
    left, bottom, right, top = marker.bounds
    color = color_for(marker.state)
    for start, end in (
        ((left, bottom), (right, bottom)),
        ((right, bottom), (right, top)),
        ((right, top), (left, top)),
        ((left, top), (left, bottom)),
    ):
        _draw_segment(shader, start, end, 8.0, HALO)
        _draw_segment(shader, start, end, 3.0, color)
    _draw_badge(shader, marker.badge_center, marker.ordinal, marker.state)


def _draw_node_overlay() -> None:
    """Draw exact node frames and one honest focused-instruction callout."""

    if _session_provider is None or _menu_guidance_provider is None:
        return
    context = bpy.context
    space_node_editor = getattr(bpy.types, "SpaceNodeEditor", None)
    if (
        space_node_editor is None
        or not isinstance(getattr(context, "space_data", None), space_node_editor)
        or getattr(context, "region", None) is None
    ):
        return
    session = _session_provider()
    snapshot = _menu_guidance_provider()
    if snapshot is None or not _leaf_operations(snapshot):
        return
    markers = _resolve_node_editor_markers(context, session, snapshot)
    marker_by_operation = {marker.operation_id: marker for marker in markers}
    focused = snapshot.focused_operation
    focused_marker = marker_by_operation.get(focused.operation_id)
    container_marker = _marker_for_container(focused, markers)
    connection_points = _connection_proxy_points(focused, markers)
    region = context.region
    native_badge_point = native_rna_badge_region_point(region, snapshot)
    shader = gpu.shader.from_builtin("UNIFORM_COLOR")
    gpu.state.blend_set("ALPHA")
    try:
        for marker in markers:
            _draw_node_marker(shader, marker)

        if container_marker is not None and focused_marker is None:
            _left, _bottom, right, top = container_marker.bounds
            _draw_badge(
                shader,
                (right - 18.0, top - 18.0),
                focused.ordinal,
                focused.state,
            )
        if connection_points is not None:
            source_point, target_point, midpoint = connection_points
            color = color_for(focused.state)
            _draw_segment(shader, source_point, target_point, 8.0, HALO)
            _draw_segment(shader, source_point, target_point, 3.0, color)
            _draw_circle(shader, target_point, 6.0, HALO)
            _draw_circle(shader, target_point, 3.0, color)
            _draw_badge(shader, midpoint, focused.ordinal, focused.state)
        if native_badge_point is not None:
            _draw_badge(
                shader,
                native_badge_point,
                focused.ordinal,
                focused.state,
            )

        left = 24.0
        top = float(region.height) - 24.0
        right = min(float(region.width) - 24.0, left + 520.0)
        bottom = top - 68.0
        if right <= left or bottom < 0:
            return
        _draw_rect(shader, left - 2.0, bottom - 2.0, right + 2.0, top + 2.0, HALO)
        _draw_rect(shader, left, bottom, right, top, SURFACE)
        target_status = (
            "EXACT NATIVE · RNA value component resolved recently"
            if native_badge_point is not None
            else _node_target_status(
                focused,
                direct_marker=focused_marker,
                container_marker=container_marker,
                connection_points=connection_points,
            )
        )
        _draw_text(
            (
                f"INSTRUCTION {focused.ordinal:02d} / "
                f"{len(snapshot.operations):02d} · {target_status}"
            ),
            (left + 14.0, top - 24.0),
            12,
            TEXT
            if (
                focused_marker is not None
                or container_marker is not None
                or connection_points is not None
                or native_badge_point is not None
            )
            else MUTED_TEXT,
        )
        detail = _focused_operation_detail(focused)
        detail_suffix = (
            f" · {_compact_label(detail, limit=72)}" if detail is not None else ""
        )
        _draw_text(
            f"{focused.ordinal:02d} {focused.label}{detail_suffix}",
            (left + 14.0, bottom + 14.0),
            12,
            color_for(focused.state),
        )
    finally:
        gpu.state.blend_set("NONE")


def _leaf_operations(menu_guidance):
    """Fail closed when a provider cannot supply the complete leaf rail."""

    operations = getattr(menu_guidance, "operations", None)
    return tuple(operations) if operations is not None else ()


def _visible_leaf_operations(
    operations,
    focused_ordinal: int | None,
    *,
    limit: int = 7,
):
    """Return a bounded rail window that keeps the focused operation visible."""

    operations = tuple(operations)
    if limit <= 0 or not operations:
        return ()
    if len(operations) <= limit:
        return operations

    focused_index = next(
        (
            index
            for index, operation in enumerate(operations)
            if operation.ordinal == focused_ordinal
        ),
        0,
    )
    start = focused_index - limit // 2
    start = max(0, min(start, len(operations) - limit))
    return operations[start : start + limit]


def _operation_parameter_text(operation) -> str | None:
    parameters = getattr(operation, "parameters", ())
    if not parameters:
        return None
    return ", ".join(
        f"{parameter.name}={parameter.display_value}" for parameter in parameters
    )


def _compact_label(value: str, limit: int = 16) -> str:
    return value if len(value) <= limit else value[: limit - 1] + "…"


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
    leaf_operations = _leaf_operations(menu_guidance) if menu_guidance is not None else ()
    if menu_guidance is not None and not leaf_operations:
        menu_guidance = None
    visible_operations = _visible_leaf_operations(
        leaf_operations,
        getattr(menu_guidance, "focused_ordinal", None),
        limit=11 if getattr(menu_guidance, "candidate_only", False) else 7,
    )
    parameter_operations = tuple(
        operation
        for operation in visible_operations
        if _operation_parameter_text(operation) is not None
    )
    operation_detail_height = len(parameter_operations) * 20.0 + (
        8.0 if parameter_operations else 0.0
    )
    card_width = min(600.0, max(390.0, float(region.width) - 48.0))
    card_height = (
        284.0 + operation_detail_height
        if menu_guidance is not None
        else 210.0
    )
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
        back_y = bottom + (
            142.0 + operation_detail_height
            if menu_guidance is not None
            else 62.0
        )
        next_y = bottom + (
            116.0 + operation_detail_height
            if menu_guidance is not None
            else 36.0
        )
        semantic_y = bottom + (
            94.0 + operation_detail_height
            if menu_guidance is not None
            else 14.0
        )
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
            operation_end = leaf_operations[-1].ordinal if leaf_operations else 0
            has_reference = any(
                getattr(operation, "reference", not menu_guidance.native)
                for operation in leaf_operations
            )
            path_status = (
                f"CANDIDATE ONLY  01–{operation_end:02d} · native in-place · "
                "no managed receipt or replacement"
                if getattr(menu_guidance, "candidate_only", False)
                else f"LEAF OPERATIONS  01–{operation_end:02d} · markers only on verified targets"
                if has_reference
                else f"LEAF OPERATIONS  01–{operation_end:02d} · verified native path"
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
                len(visible_operations) - 1,
                1,
            )
            path_y = bottom + 43.0 + operation_detail_height
            path_centers = [
                (path_left + index * path_spacing, path_y)
                for index in range(len(visible_operations))
            ]
            for item_index, item in enumerate(visible_operations):
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
                    _compact_label(item.label),
                    (center[0], bottom + 15.0 + operation_detail_height),
                    11,
                    TEXT,
                )
            detail_y = bottom + operation_detail_height - 12.0
            for operation in parameter_operations:
                parameter_text = _operation_parameter_text(operation)
                assert parameter_text is not None
                availability = (
                    "REFERENCE ONLY · "
                    if getattr(operation, "reference", False)
                    else ""
                )
                detail_text = (
                    f"{operation.ordinal:02d} {operation.label}: {parameter_text} · "
                    f"{availability}UI target unavailable"
                    if availability
                    else f"{operation.ordinal:02d} {operation.label}: {parameter_text}"
                )
                _draw_text(
                    _compact_label(detail_text, limit=76),
                    (left + 20.0, detail_y),
                    11,
                    MUTED_TEXT if availability else TEXT,
                )
                detail_y -= 20.0
        elif semantic_hint is not None:
            _draw_text(
                semantic_hint,
                (left + 20.0, semantic_y),
                12,
                MUTED_TEXT,
            )
    finally:
        gpu.state.blend_set("NONE")
