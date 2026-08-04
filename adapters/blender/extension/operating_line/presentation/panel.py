"""Recursive VIEW_3D sidebar UI for OperatingLine plans."""

import bpy

from ..application import GuidanceState, node_state
from ..visual_theme import STATE_ICONS, STATE_SYMBOLS


def _step_ordinal(index: int | None) -> str:
    return "--" if index is None else f"{index + 1:02d}"


def _draw_node(layout, node, session, depth: int = 0) -> None:
    state = node_state(session, node)
    row = layout.row(align=True)
    if depth:
        row.separator(factor=float(depth))
    if node.children:
        expanded = session.is_expanded(node.id)
        operator = row.operator(
            "operating_line.toggle_branch",
            text="",
            icon="DOWNARROW_HLT" if expanded else "RIGHTARROW",
            emboss=False,
        )
        operator.node_id = node.id
    else:
        row.separator(factor=1.0)
    row.label(
        text=f"{STATE_SYMBOLS[state]}  {node.number}  {node.title}",
        icon=STATE_ICONS[state],
    )
    if node.children and session.is_expanded(node.id):
        for child in node.children:
            _draw_node(layout, child, session, depth + 1)


def _draw_walkthrough_controls(layout, session) -> None:
    start = layout.row()
    start.scale_y = 1.15
    start.operator(
        "operating_line.start",
        text="Restart Walkthrough" if session.started else "Start Walkthrough",
        icon="PLAY",
    )

    active = session.active_step
    next_index = session.active_index + 1
    next_step = session.steps[next_index] if next_index < len(session.steps) else None

    controls = layout.row(align=True)
    controls.scale_y = 1.35
    back = controls.row(align=True)
    back.enabled = active is not None
    back.alert = active is not None
    back.operator(
        "operating_line.back",
        text=f"Back {_step_ordinal(session.active_index if active else None)}",
        icon=STATE_ICONS[GuidanceState.BACK] if active else "LOCKED",
    )
    forward = controls.row(align=True)
    forward.enabled = next_step is not None
    forward.operator(
        "operating_line.next",
        text=f"{_step_ordinal(next_index if next_step else None)} Next",
        icon=STATE_ICONS[GuidanceState.NEXT] if next_step else "CHECKMARK",
    )


def _draw_guidance_status(layout, session) -> None:
    active = session.active_step
    next_index = session.active_index + 1
    next_step = session.steps[next_index] if next_index < len(session.steps) else None

    status = layout.box()
    status.label(
        text=f"Progress {session.active_index + 1:02d} / {len(session.steps):02d}",
        icon="INFO",
    )
    if active is None:
        status.label(text="Back --  Nothing to roll back", icon="LOCKED")
    else:
        status.label(
            text=f"Back {session.active_index + 1:02d}  {active.title}",
            icon=STATE_ICONS[GuidanceState.BACK],
        )
    if next_step is None:
        status.label(text="Next --  Walkthrough complete", icon="CHECKMARK")
    else:
        status.label(
            text=f"Next {next_index + 1:02d}  {next_step.title}",
            icon=STATE_ICONS[GuidanceState.NEXT],
        )


class OPERATINGLINE_PT_sidebar(bpy.types.Panel):
    bl_label = "OperatingLine"
    bl_idname = "OPERATINGLINE_PT_sidebar"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "OperatingLine"

    def draw(self, context):
        from .. import get_session

        layout = self.layout
        session = get_session()

        from .. import get_companion

        companion = get_companion()
        connection = layout.box()
        connection.label(text="Live companion", icon="URL")
        connection.prop(context.window_manager, "operating_line_runtime_url")
        connection.prop(context.window_manager, "operating_line_bearer_token")
        connection_controls = connection.row(align=True)
        if companion.connected:
            connection_controls.operator("operating_line.disconnect", icon="UNLINKED")
        else:
            connection_controls.enabled = getattr(bpy.app, "online_access", True)
            connection_controls.operator("operating_line.connect", icon="LINKED")
        connection.label(text=companion.status)
        if not getattr(bpy.app, "online_access", True):
            connection.label(text="Online access is disabled in Blender", icon="ERROR")
        elif companion.error:
            connection.label(text=companion.error, icon="ERROR")

        layout.prop(context.scene, "operating_line_replace_factory_scene")
        _draw_walkthrough_controls(layout, session)

        overlay = layout.row()
        guidance_visible = context.window_manager.operating_line_overlay_enabled
        overlay.operator(
            "operating_line.toggle_overlay",
            text="Hide Guidance" if guidance_visible else "Show Guidance",
            icon="HIDE_OFF" if guidance_visible else "HIDE_ON",
        )

        if not guidance_visible:
            hidden = layout.box()
            hidden.label(text="Guidance hidden; walkthrough state preserved", icon="HIDE_ON")
            return

        layout.separator()
        _draw_guidance_status(layout, session)

        tree = layout.box()
        tree.label(text="Task tree", icon="OUTLINER")
        _draw_node(tree, session.root, session)


CLASSES = (OPERATINGLINE_PT_sidebar,)
