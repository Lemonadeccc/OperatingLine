"""Allowlisted guidance inside Blender's real Add > Mesh menus."""

from collections.abc import Callable

import bpy
from bpy.app.translations import contexts as i18n_contexts

from ..application import (
    MenuGuidanceItem,
    MenuGuidanceRole,
    MenuGuidanceSnapshot,
    MenuGuidanceTracker,
)
from ..visual_theme import STATE_ICONS


_SUPPORTED_BLENDER_SERIES = {(4, 5), (5, 1)}
_MESH_ITEMS = (
    ("mesh.primitive_plane_add", "Plane", "MESH_PLANE"),
    ("mesh.primitive_cube_add", "Cube", "MESH_CUBE"),
    ("mesh.primitive_circle_add", "Circle", "MESH_CIRCLE"),
    ("mesh.primitive_uv_sphere_add", "UV Sphere", "MESH_UVSPHERE"),
    ("mesh.primitive_ico_sphere_add", "Ico Sphere", "MESH_ICOSPHERE"),
    ("mesh.primitive_cylinder_add", "Cylinder", "MESH_CYLINDER"),
    ("mesh.primitive_cone_add", "Cone", "MESH_CONE"),
    ("mesh.primitive_torus_add", "Torus", "MESH_TORUS"),
)
_MESH_ITEMS_AFTER_SEPARATOR = (
    ("mesh.primitive_grid_add", "Grid", "MESH_GRID"),
    ("mesh.primitive_monkey_add", "Monkey", "MESH_MONKEY"),
)

_tracker = MenuGuidanceTracker()
_session_provider: Callable | None = None
_original_editor_draw = None
_original_add_draw = None
_original_mesh_draw = None
_original_select_edit_mesh_draw = None
_original_edit_mesh_edges_draw = None
_original_add_label: str | None = None


def _supported_blender() -> bool:
    return tuple(bpy.app.version[:2]) in _SUPPORTED_BLENDER_SERIES


def _guidance_step():
    if _session_provider is None:
        return None
    session = _session_provider()
    return session.guidance_step


def _localized(value: str) -> str:
    return bpy.app.translations.pgettext_iface(value)


def _menu_suffix(snapshot: MenuGuidanceSnapshot, item_label: str) -> str:
    item = next(item for item in snapshot.items if item.label == item_label)
    if item.role is MenuGuidanceRole.PREVIOUS:
        return f"{item.ordinal:02d} BACK"
    if item.role is MenuGuidanceRole.CURRENT:
        return f"{item.ordinal:02d} CURRENT"
    suffix = "·".join(
        f"{ordinal:02d}"
        for ordinal in snapshot.collapsed_ordinals(item_label)
    )
    if item.role is MenuGuidanceRole.NEXT:
        return f"{suffix} NEXT"
    return suffix


def _menu_item(
    snapshot: MenuGuidanceSnapshot,
    item_label: str,
) -> MenuGuidanceItem:
    return next(item for item in snapshot.items if item.label == item_label)


def native_menu_snapshot() -> MenuGuidanceSnapshot | None:
    """Return only a path wired to the supported real Blender menus."""

    snapshot = interaction_guidance_snapshot()
    return snapshot if snapshot is not None and snapshot.native else None


def candidate_menu_snapshot() -> MenuGuidanceSnapshot | None:
    """Return display-only native UI instructions with no managed authority."""

    snapshot = interaction_guidance_snapshot()
    return snapshot if snapshot is not None and snapshot.candidate_only else None


def interaction_guidance_snapshot() -> MenuGuidanceSnapshot | None:
    """Return the active leaf's catalog path, including semantic fallbacks."""

    if not native_menu_guidance_enabled():
        return None
    return _tracker.snapshot(_guidance_step())


def leaf_guidance_snapshot(step) -> MenuGuidanceSnapshot | None:
    """Return the shared leaf rail even when editor markers are hidden.

    Marker visibility controls Blender menu patches and viewport drawing only.
    The leaf-local instruction position belongs to the walkthrough, so hiding
    those presentation surfaces must not create a second cursor or reset it.
    """

    return _tracker.snapshot(step)


def focus_previous_leaf_operation(
    step,
    expected_operation_id: str,
    expected_ordinal: int,
    expected_cursor_token: str,
) -> bool:
    """Move the shared instructional cursor backward without scene mutation."""

    return _tracker.focus_back(
        step,
        expected_operation_id,
        expected_ordinal,
        expected_cursor_token,
    )


def focus_next_leaf_operation(
    step,
    expected_operation_id: str,
    expected_ordinal: int,
    expected_cursor_token: str,
) -> bool:
    """Move the shared instructional cursor forward without scene mutation."""

    return _tracker.focus_next(
        step,
        expected_operation_id,
        expected_ordinal,
        expected_cursor_token,
    )


def retry_leaf_operation(
    step,
    expected_operation_id: str,
    expected_ordinal: int,
    expected_cursor_token: str,
) -> bool:
    """Re-focus the same instruction without repeating its Blender action."""

    return _tracker.retry_focus(
        step,
        expected_operation_id,
        expected_ordinal,
        expected_cursor_token,
    )


def reveal_native_menu(label: str) -> bool:
    """Reveal one real menu depth without executing or mutating the scene."""

    if not native_menu_guidance_enabled():
        return False
    step = _guidance_step()
    if step is None or not _tracker.reveal(step, label):
        return False
    return True


def guided_menu_action_matches(step_id: str, operator_id: str) -> bool:
    """Fail closed unless the visible final menu item matches the next leaf."""

    if _session_provider is None or _session_provider().observation_blocked:
        return False
    snapshot = native_menu_snapshot()
    return (
        snapshot is not None
        and snapshot.revealed_depth >= 3
        and snapshot.step_id == step_id
        and snapshot.accepts(operator_id)
    )


def refresh_native_menu_guidance() -> None:
    if native_menu_guidance_enabled():
        interaction_guidance_snapshot()


def reset_native_menu_guidance() -> None:
    """Reset transient reveal state while preserving the accepted plan."""

    _tracker.reset()
    refresh_native_menu_guidance()


def _draw_add_guided(self, context) -> None:
    reveal_native_menu("Add")
    snapshot = native_menu_snapshot()
    if snapshot is None:
        assert _original_add_draw is not None
        _original_add_draw(self, context)
        return

    layout = self.layout
    if layout.operator_context == "EXEC_REGION_WIN":
        layout.operator_context = "INVOKE_REGION_WIN"
        layout.operator(
            "WM_OT_search_single_menu",
            text="Search...",
            icon="VIEWZOOM",
        ).menu_idname = "VIEW3D_MT_add"
        layout.separator()
    layout.operator_context = "EXEC_REGION_WIN"

    mesh_item = _menu_item(snapshot, "Mesh")
    mesh_row = layout.row(align=True)
    mesh_row.alert = mesh_item.role is MenuGuidanceRole.PREVIOUS
    mesh_row.menu(
        "VIEW3D_MT_mesh_add",
        text=f"{_localized('Mesh')}    {_menu_suffix(snapshot, 'Mesh')}",
        icon=STATE_ICONS[mesh_item.state],
    )

    layout.menu("VIEW3D_MT_curve_add", icon="OUTLINER_OB_CURVE")
    layout.menu("VIEW3D_MT_surface_add", icon="OUTLINER_OB_SURFACE")
    layout.menu("VIEW3D_MT_metaball_add", text="Metaball", icon="OUTLINER_OB_META")
    layout.operator("object.text_add", text="Text", icon="OUTLINER_OB_FONT")
    layout.operator(
        "object.pointcloud_random_add",
        text="Point Cloud",
        icon="OUTLINER_OB_POINTCLOUD",
    )
    layout.menu(
        "VIEW3D_MT_volume_add",
        text="Volume",
        text_ctxt=i18n_contexts.id_id,
        icon="OUTLINER_OB_VOLUME",
    )
    layout.menu(
        "VIEW3D_MT_grease_pencil_add",
        text="Grease Pencil",
        icon="OUTLINER_OB_GREASEPENCIL",
    )

    layout.separator()
    if bpy.types.VIEW3D_MT_armature_add.is_extended():
        layout.menu("VIEW3D_MT_armature_add", icon="OUTLINER_OB_ARMATURE")
    else:
        layout.operator(
            "object.armature_add",
            text="Armature",
            icon="OUTLINER_OB_ARMATURE",
        )
    if tuple(bpy.app.version[:2]) >= (5, 0):
        layout.menu("VIEW3D_MT_lattice_add", icon="OUTLINER_OB_LATTICE")
    else:
        layout.operator(
            "object.add",
            text="Lattice",
            icon="OUTLINER_OB_LATTICE",
        ).type = "LATTICE"

    layout.separator()
    layout.menu("VIEW3D_MT_empty_add", icon="OUTLINER_OB_EMPTY")
    layout.menu("VIEW3D_MT_image_add", text="Image", icon="OUTLINER_OB_IMAGE")

    layout.separator()
    layout.menu("VIEW3D_MT_light_add", icon="OUTLINER_OB_LIGHT")
    layout.menu("VIEW3D_MT_lightprobe_add", icon="OUTLINER_OB_LIGHTPROBE")

    layout.separator()
    if bpy.types.VIEW3D_MT_camera_add.is_extended():
        layout.menu("VIEW3D_MT_camera_add", icon="OUTLINER_OB_CAMERA")
    else:
        bpy.types.VIEW3D_MT_camera_add.draw(self, context)

    layout.separator()
    layout.operator("object.speaker_add", text="Speaker", icon="OUTLINER_OB_SPEAKER")

    layout.separator()
    layout.operator_menu_enum(
        "object.effector_add",
        "type",
        text="Force Field",
        icon="OUTLINER_OB_FORCE_FIELD",
    )

    layout.separator()
    has_collections = bool(bpy.data.collections)
    collection_column = layout.column()
    collection_column.enabled = has_collections
    if not has_collections or len(bpy.data.collections) > 10:
        collection_column.operator_context = "INVOKE_REGION_WIN"
        collection_column.operator(
            "object.collection_instance_add",
            text=(
                "Collection Instance..."
                if has_collections
                else "No Collections to Instance"
            ),
            icon="OUTLINER_OB_GROUP_INSTANCE",
        )
    else:
        collection_column.operator_menu_enum(
            "object.collection_instance_add",
            "collection",
            text="Collection Instance",
            icon="OUTLINER_OB_GROUP_INSTANCE",
        )


def _draw_editor_guided(self, context) -> None:
    candidate = candidate_menu_snapshot()
    if candidate is not None and context.mode == "EDIT_MESH":
        operation_by_target = {
            operation.target_id: operation for operation in candidate.operations
        }
        select_operation = operation_by_target.get("VIEW3D_MT_select_edit_mesh")
        edge_operation = operation_by_target.get("VIEW3D_MT_edit_mesh_edges")
        assert _original_editor_draw is not None
        _original_editor_draw(self, context)
        layout = self.layout
        layout.separator()
        layout.menu(
            "VIEW3D_MT_select_edit_mesh",
            text=(
                f"{_localized('Select')}    {select_operation.ordinal:02d} CANDIDATE"
                if select_operation is not None
                else _localized("Select")
            ),
            icon=(
                STATE_ICONS[select_operation.state]
                if select_operation is not None
                else "NONE"
            ),
        )
        layout.menu(
            "VIEW3D_MT_edit_mesh_edges",
            text=(
                f"{_localized('Edge')}    {edge_operation.ordinal:02d} CANDIDATE"
                if edge_operation is not None
                else _localized("Edge")
            ),
            icon=(
                STATE_ICONS[edge_operation.state]
                if edge_operation is not None
                else "NONE"
            ),
        )
        return

    snapshot = native_menu_snapshot()
    if snapshot is None or context.mode != "OBJECT":
        assert _original_editor_draw is not None
        _original_editor_draw(self, context)
        return

    layout = self.layout
    layout.menu("VIEW3D_MT_view")
    layout.menu("VIEW3D_MT_select_object")
    assert _original_add_label is not None
    add_item = _menu_item(snapshot, "Add")
    add_row = layout.row(align=True)
    add_row.alert = add_item.role is MenuGuidanceRole.PREVIOUS
    add_row.operator(
        "operating_line.open_add_menu",
        text=f"{_localized(_original_add_label)}   {_menu_suffix(snapshot, 'Add')}",
        icon=STATE_ICONS[add_item.state],
        depress=add_item.role is MenuGuidanceRole.CURRENT,
    )
    layout.menu("VIEW3D_MT_object")
    layout.template_node_operator_asset_root_items()


def _draw_ordinary_operator(layout, operator_id: str, text: str, icon: str) -> None:
    layout.operator(operator_id, text=text, icon=icon)


def _draw_guided_operator(
    layout,
    snapshot: MenuGuidanceSnapshot,
    operator_id: str,
    text: str,
) -> None:
    item = next(item for item in snapshot.items if item.target_id == operator_id)
    action = layout.operator(
        "operating_line.guided_menu_action",
        text=f"{text}    {item.ordinal:02d} NEXT",
        icon="COLLECTION_COLOR_04",
    )
    action.step_id = snapshot.step_id
    action.operator_id = operator_id


def _draw_alternative_operator(
    layout,
    snapshot: MenuGuidanceSnapshot,
    operator_id: str,
    text: str,
) -> None:
    final_ordinal = snapshot.items[-1].ordinal
    action = layout.operator(
        "operating_line.guided_menu_action",
        text=f"{text}    {final_ordinal:02d} ALT",
        icon="LOCKED",
    )
    action.step_id = snapshot.step_id
    action.operator_id = operator_id


def _draw_mesh_guided(self, context) -> None:
    reveal_native_menu("Mesh")
    snapshot = native_menu_snapshot()
    if snapshot is None:
        assert _original_mesh_draw is not None
        _original_mesh_draw(self, context)
        return

    layout = self.layout
    layout.operator_context = "INVOKE_REGION_WIN"
    for operator_id, text, icon in _MESH_ITEMS:
        if snapshot.accepts(operator_id):
            _draw_guided_operator(layout, snapshot, operator_id, text)
        elif (
            snapshot.operator_id == "mesh.primitive_uv_sphere_add"
            and operator_id == "mesh.primitive_ico_sphere_add"
        ):
            _draw_alternative_operator(layout, snapshot, operator_id, text)
        else:
            _draw_ordinary_operator(layout, operator_id, text, icon)
    layout.separator()
    for operator_id, text, icon in _MESH_ITEMS_AFTER_SEPARATOR:
        _draw_ordinary_operator(layout, operator_id, text, icon)
    layout.template_node_operator_asset_menu_items(catalog_path="Add")


def _draw_select_edit_mesh_guided(self, context) -> None:
    snapshot = candidate_menu_snapshot()
    operation = next(
        (
            candidate
            for candidate in snapshot.operations
            if candidate.target_id == "mesh.select_all"
        ),
        None,
    ) if snapshot is not None else None
    if operation is not None and context.mode == "EDIT_MESH":
        row = self.layout.row(align=True)
        row.alert = operation.role is MenuGuidanceRole.CURRENT
        action = row.operator(
            "mesh.select_all",
            text=f"All    {operation.ordinal:02d} CANDIDATE ONLY",
            icon=STATE_ICONS[operation.state],
        )
        action.action = "SELECT"
        self.layout.separator()
    assert _original_select_edit_mesh_draw is not None
    _original_select_edit_mesh_draw(self, context)


def _draw_edit_mesh_edges_guided(self, context) -> None:
    snapshot = candidate_menu_snapshot()
    operation = next(
        (
            candidate
            for candidate in snapshot.operations
            if candidate.target_id == "mesh.subdivide"
        ),
        None,
    ) if snapshot is not None else None
    if operation is not None and context.mode == "EDIT_MESH":
        row = self.layout.row(align=True)
        row.alert = operation.role is MenuGuidanceRole.CURRENT
        row.operator(
            "mesh.subdivide",
            text=f"Subdivide    {operation.ordinal:02d} CANDIDATE ONLY",
            icon=STATE_ICONS[operation.state],
        )
        self.layout.separator()
    assert _original_edit_mesh_edges_draw is not None
    _original_edit_mesh_edges_draw(self, context)


def enable_native_menu_guidance(session_provider: Callable) -> bool:
    """Patch only the verified Blender menu classes while Guidance is visible."""

    global _session_provider
    global _original_editor_draw, _original_add_draw, _original_mesh_draw
    global _original_select_edit_mesh_draw, _original_edit_mesh_edges_draw
    global _original_add_label
    if native_menu_guidance_enabled():
        _session_provider = session_provider
        reset_native_menu_guidance()
        return True
    if any(
        original is not None
        for original in (
            _original_editor_draw,
            _original_add_draw,
            _original_mesh_draw,
            _original_select_edit_mesh_draw,
            _original_edit_mesh_edges_draw,
        )
    ):
        disable_native_menu_guidance()
    if not _supported_blender():
        _session_provider = None
        return False
    _session_provider = session_provider
    _original_editor_draw = bpy.types.VIEW3D_MT_editor_menus.draw
    _original_add_draw = bpy.types.VIEW3D_MT_add.draw
    _original_mesh_draw = bpy.types.VIEW3D_MT_mesh_add.draw
    select_edit_mesh = getattr(bpy.types, "VIEW3D_MT_select_edit_mesh", None)
    edit_mesh_edges = getattr(bpy.types, "VIEW3D_MT_edit_mesh_edges", None)
    _original_select_edit_mesh_draw = (
        select_edit_mesh.draw if select_edit_mesh is not None else None
    )
    _original_edit_mesh_edges_draw = (
        edit_mesh_edges.draw if edit_mesh_edges is not None else None
    )
    _original_add_label = bpy.types.VIEW3D_MT_add.bl_label
    bpy.types.VIEW3D_MT_editor_menus.draw = _draw_editor_guided
    bpy.types.VIEW3D_MT_add.draw = _draw_add_guided
    bpy.types.VIEW3D_MT_mesh_add.draw = _draw_mesh_guided
    if select_edit_mesh is not None:
        select_edit_mesh.draw = _draw_select_edit_mesh_guided
    if edit_mesh_edges is not None:
        edit_mesh_edges.draw = _draw_edit_mesh_edges_guided
    refresh_native_menu_guidance()
    return True


def disable_native_menu_guidance(*, reset_tracker: bool = True) -> None:
    """Restore host class methods and optionally retain instruction progress."""

    global _session_provider
    global _original_editor_draw, _original_add_draw, _original_mesh_draw
    global _original_select_edit_mesh_draw, _original_edit_mesh_edges_draw
    global _original_add_label
    if (
        _original_editor_draw is not None
        and bpy.types.VIEW3D_MT_editor_menus.draw is _draw_editor_guided
    ):
        bpy.types.VIEW3D_MT_editor_menus.draw = _original_editor_draw
    if (
        _original_add_draw is not None
        and bpy.types.VIEW3D_MT_add.draw is _draw_add_guided
    ):
        bpy.types.VIEW3D_MT_add.draw = _original_add_draw
    if (
        _original_mesh_draw is not None
        and bpy.types.VIEW3D_MT_mesh_add.draw is _draw_mesh_guided
    ):
        bpy.types.VIEW3D_MT_mesh_add.draw = _original_mesh_draw
    select_edit_mesh = getattr(bpy.types, "VIEW3D_MT_select_edit_mesh", None)
    if (
        select_edit_mesh is not None
        and _original_select_edit_mesh_draw is not None
        and select_edit_mesh.draw is _draw_select_edit_mesh_guided
    ):
        select_edit_mesh.draw = _original_select_edit_mesh_draw
    edit_mesh_edges = getattr(bpy.types, "VIEW3D_MT_edit_mesh_edges", None)
    if (
        edit_mesh_edges is not None
        and _original_edit_mesh_edges_draw is not None
        and edit_mesh_edges.draw is _draw_edit_mesh_edges_guided
    ):
        edit_mesh_edges.draw = _original_edit_mesh_edges_draw
    if reset_tracker:
        _tracker.reset()
    _session_provider = None
    _original_editor_draw = None
    _original_add_draw = None
    _original_mesh_draw = None
    _original_select_edit_mesh_draw = None
    _original_edit_mesh_edges_draw = None
    _original_add_label = None


def native_menu_guidance_enabled() -> bool:
    select_edit_mesh = getattr(bpy.types, "VIEW3D_MT_select_edit_mesh", None)
    edit_mesh_edges = getattr(bpy.types, "VIEW3D_MT_edit_mesh_edges", None)
    return (
        _session_provider is not None
        and _original_editor_draw is not None
        and _original_add_draw is not None
        and _original_mesh_draw is not None
        and bpy.types.VIEW3D_MT_editor_menus.draw is _draw_editor_guided
        and bpy.types.VIEW3D_MT_add.draw is _draw_add_guided
        and bpy.types.VIEW3D_MT_mesh_add.draw is _draw_mesh_guided
        and (
            select_edit_mesh is None
            or select_edit_mesh.draw is _draw_select_edit_mesh_guided
        )
        and (
            edit_mesh_edges is None
            or edit_mesh_edges.draw is _draw_edit_mesh_edges_guided
        )
    )


__all__ = (
    "disable_native_menu_guidance",
    "candidate_menu_snapshot",
    "enable_native_menu_guidance",
    "focus_next_leaf_operation",
    "focus_previous_leaf_operation",
    "guided_menu_action_matches",
    "interaction_guidance_snapshot",
    "leaf_guidance_snapshot",
    "native_menu_guidance_enabled",
    "native_menu_snapshot",
    "refresh_native_menu_guidance",
    "reset_native_menu_guidance",
    "retry_leaf_operation",
    "reveal_native_menu",
)
