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


def _companion():
    from .. import get_companion

    return get_companion()


class OPERATINGLINE_OT_start(bpy.types.Operator):
    bl_idname = "operating_line.start"
    bl_label = "Start"
    bl_description = "Reset and start the snowman walkthrough"
    bl_options = {"REGISTER"}

    def execute(self, context):
        session = _session()
        try:
            session.start()
        except (OSError, RuntimeError, ValueError) as error:
            _companion().report(
                "error",
                step=session.active_step,
                error=str(error),
            )
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if context.scene.operating_line_replace_factory_scene:
            removed = remove_factory_startup_objects(context.scene)
            if not removed:
                self.report(
                    {"WARNING"},
                    "Factory scene fingerprint did not match; no existing object was deleted",
                )
        context.window_manager.operating_line_overlay_enabled = True
        enable_overlay(_session)
        _companion().report("walkthrough_started")
        return {"FINISHED"}


class OPERATINGLINE_OT_next(bpy.types.Operator):
    bl_idname = "operating_line.next"
    bl_label = "Next"
    bl_description = "Execute the next deterministic snowman step"
    bl_options = {"REGISTER"}

    def execute(self, _context):
        session = _session()
        next_index = session.active_index + 1
        candidate = (
            session.steps[next_index] if next_index < len(session.steps) else None
        )
        try:
            step = session.next()
        except (OSError, RuntimeError, ValueError) as error:
            _companion().report("error", step=candidate, error=str(error))
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if step is None:
            self.report({"INFO"}, "All demo steps are complete")
            return {"CANCELLED"}
        _companion().report("step_succeeded", step=step)
        return {"FINISHED"}


class OPERATINGLINE_OT_back(bpy.types.Operator):
    bl_idname = "operating_line.back"
    bl_label = "Back"
    bl_description = "Roll back the active action-owned snowman step"
    bl_options = {"REGISTER"}

    def execute(self, _context):
        session = _session()
        candidate = session.active_step
        try:
            step = session.back()
        except (OSError, RuntimeError, ValueError) as error:
            _companion().report("error", step=candidate, error=str(error))
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if step is None:
            self.report({"INFO"}, "No active step to roll back")
            return {"CANCELLED"}
        _companion().report("step_rolled_back", step=step)
        return {"FINISHED"}


class OPERATINGLINE_OT_connect(bpy.types.Operator):
    bl_idname = "operating_line.connect"
    bl_label = "Connect"
    bl_description = "Connect to a loopback OperatingLine runtime"

    def execute(self, context):
        window_manager = context.window_manager
        try:
            _companion().connect(
                window_manager.operating_line_runtime_url,
                window_manager.operating_line_bearer_token,
            )
        except ValueError as error:
            _companion().error = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class OPERATINGLINE_OT_disconnect(bpy.types.Operator):
    bl_idname = "operating_line.disconnect"
    bl_label = "Disconnect"
    bl_description = "Disconnect from the OperatingLine runtime"

    def execute(self, _context):
        _companion().disconnect()
        return {"FINISHED"}


class OPERATINGLINE_OT_toggle_overlay(bpy.types.Operator):
    bl_idname = "operating_line.toggle_overlay"
    bl_label = "Show or Hide Guidance"
    bl_description = "Show or hide the viewport guidance, status, and task tree"

    def execute(self, context):
        if overlay_enabled():
            disable_overlay()
            context.window_manager.operating_line_overlay_enabled = False
        else:
            enable_overlay(_session)
            context.window_manager.operating_line_overlay_enabled = True
        return {"FINISHED"}


class OPERATINGLINE_OT_toggle_branch(bpy.types.Operator):
    bl_idname = "operating_line.toggle_branch"
    bl_label = "Toggle Task Branch"

    node_id: bpy.props.StringProperty()

    def execute(self, _context):
        _session().toggle_expanded(self.node_id)
        return {"FINISHED"}


CLASSES = (
    OPERATINGLINE_OT_connect,
    OPERATINGLINE_OT_disconnect,
    OPERATINGLINE_OT_start,
    OPERATINGLINE_OT_next,
    OPERATINGLINE_OT_back,
    OPERATINGLINE_OT_toggle_overlay,
    OPERATINGLINE_OT_toggle_branch,
)
