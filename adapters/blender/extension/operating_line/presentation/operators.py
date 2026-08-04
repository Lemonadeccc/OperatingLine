"""Operators exposing the snowman demo use cases."""

import bpy

from ..infrastructure import (
    disable_overlay,
    enable_overlay,
    overlay_enabled,
    remove_factory_startup_objects,
)


def _session():
    from .. import get_session

    return get_session()


class OPERATINGLINE_OT_start(bpy.types.Operator):
    bl_idname = "operating_line.start"
    bl_label = "Start"
    bl_description = "Reset and start the snowman walkthrough"
    bl_options = {"REGISTER"}

    def execute(self, context):
        _session().start()
        if context.scene.operating_line_replace_factory_scene:
            removed = remove_factory_startup_objects(context.scene)
            if not removed:
                self.report(
                    {"WARNING"},
                    "Factory scene fingerprint did not match; no existing object was deleted",
                )
        context.scene.operating_line_overlay_enabled = True
        enable_overlay(_session)
        return {"FINISHED"}


class OPERATINGLINE_OT_next(bpy.types.Operator):
    bl_idname = "operating_line.next"
    bl_label = "Next"
    bl_description = "Execute the next deterministic snowman step"
    bl_options = {"REGISTER"}

    def execute(self, _context):
        step = _session().next()
        if step is None:
            self.report({"INFO"}, "All demo steps are complete")
            return {"CANCELLED"}
        return {"FINISHED"}


class OPERATINGLINE_OT_back(bpy.types.Operator):
    bl_idname = "operating_line.back"
    bl_label = "Back"
    bl_description = "Roll back the active action-owned snowman step"
    bl_options = {"REGISTER"}

    def execute(self, _context):
        step = _session().back()
        if step is None:
            self.report({"INFO"}, "No active step to roll back")
            return {"CANCELLED"}
        return {"FINISHED"}


class OPERATINGLINE_OT_toggle_overlay(bpy.types.Operator):
    bl_idname = "operating_line.toggle_overlay"
    bl_label = "Toggle Overlay"
    bl_description = "Show or hide viewport step guidance"

    def execute(self, context):
        if overlay_enabled():
            disable_overlay()
            context.scene.operating_line_overlay_enabled = False
        else:
            enable_overlay(_session)
            context.scene.operating_line_overlay_enabled = True
        return {"FINISHED"}


class OPERATINGLINE_OT_toggle_branch(bpy.types.Operator):
    bl_idname = "operating_line.toggle_branch"
    bl_label = "Toggle Task Branch"

    node_id: bpy.props.StringProperty()

    def execute(self, _context):
        _session().toggle_expanded(self.node_id)
        return {"FINISHED"}


CLASSES = (
    OPERATINGLINE_OT_start,
    OPERATINGLINE_OT_next,
    OPERATINGLINE_OT_back,
    OPERATINGLINE_OT_toggle_overlay,
    OPERATINGLINE_OT_toggle_branch,
)
