"""Recursive VIEW_3D sidebar UI for OperatingLine plans."""

import bpy


def _draw_node(layout, node, session, depth: int = 0) -> None:
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
        active = session.active_step is node
        row.label(text="", icon="RADIOBUT_ON" if active else "RADIOBUT_OFF")
    row.label(text=f"{node.number}  {node.title}")
    if node.children and session.is_expanded(node.id):
        for child in node.children:
            _draw_node(layout, child, session, depth + 1)


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

        layout.prop(context.scene, "operating_line_replace_factory_scene")
        controls = layout.row(align=True)
        controls.operator("operating_line.start", icon="PLAY")
        controls.operator("operating_line.back", icon="TRIA_LEFT")
        controls.operator("operating_line.next", icon="TRIA_RIGHT")
        overlay = layout.row()
        icon = "HIDE_OFF" if context.scene.operating_line_overlay_enabled else "HIDE_ON"
        overlay.operator("operating_line.toggle_overlay", icon=icon)

        layout.separator()
        _draw_node(layout, session.root, session)

        active = session.active_step
        status = layout.box()
        status.label(text="Active step", icon="INFO")
        status.label(text=f"{active.number}  {active.title}" if active else "Not started")


CLASSES = (OPERATINGLINE_PT_sidebar,)
