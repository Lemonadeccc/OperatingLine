"""Operators exposing accepted-plan guidance and proposal review use cases."""

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
    bl_description = "Reset and start the active walkthrough"
    bl_options = {"REGISTER"}

    def execute(self, context):
        if _companion().proposed_plan is not None:
            message = "Accept or reject the pending plan proposal before starting"
            self.report({"WARNING"}, message)
            return {"CANCELLED"}
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
    bl_description = "Execute the next accepted plan step"
    bl_options = {"REGISTER"}

    def execute(self, _context):
        if _companion().proposed_plan is not None:
            message = "Accept or reject the pending plan proposal before continuing"
            self.report({"WARNING"}, message)
            return {"CANCELLED"}
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
    bl_description = "Compensate the active action-owned plan step"
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


class OPERATINGLINE_OT_accept_proposal(bpy.types.Operator):
    bl_idname = "operating_line.accept_proposal"
    bl_label = "Accept Plan"
    bl_description = "Accept the reviewed proposal as the active plan without executing it"

    def execute(self, _context):
        companion = _companion()
        if companion.accept_proposal():
            self.report({"INFO"}, "Plan accepted; no step has executed yet")
            return {"FINISHED"}
        self.report({"ERROR"}, companion.error or "Plan proposal could not be accepted")
        return {"CANCELLED"}


class OPERATINGLINE_OT_reject_proposal(bpy.types.Operator):
    bl_idname = "operating_line.reject_proposal"
    bl_label = "Reject Plan"
    bl_description = "Reject the proposal without changing the active plan or scene"

    def execute(self, _context):
        companion = _companion()
        if companion.reject_proposal():
            self.report({"INFO"}, "Plan proposal rejected; active plan preserved")
            return {"FINISHED"}
        self.report({"ERROR"}, companion.error or "No plan proposal is awaiting review")
        return {"CANCELLED"}


class OPERATINGLINE_OT_reference_node(bpy.types.Operator):
    bl_idname = "operating_line.reference_node"
    bl_label = "Reference Node"
    bl_description = "Add this stable task node to an immutable revision request"

    node_id: bpy.props.StringProperty()
    scope: bpy.props.StringProperty()

    def execute(self, context):
        companion = _companion()
        try:
            node, base_changed = companion.add_revision_reference(
                self.scope,
                self.node_id,
            )
        except ValueError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}

        window_manager = context.window_manager
        token = f"@{node.number}"
        current_message = window_manager.operating_line_revision_message.strip()
        if base_changed:
            next_message = token
        elif token not in current_message.split():
            next_message = f"{current_message} {token}".strip()
        else:
            next_message = current_message
        window_manager.operating_line_revision_message = (
            f"{next_message} " if next_message else ""
        )
        companion.revision_request_status = (
            f"{token} referenced; describe the change"
        )
        return {"FINISHED"}


class OPERATINGLINE_OT_clear_revision_request(bpy.types.Operator):
    bl_idname = "operating_line.clear_revision_request"
    bl_label = "Clear Request"
    bl_description = "Clear the local revision-request draft without changing the scene"

    def execute(self, context):
        companion = _companion()
        companion.clear_revision_draft()
        companion.revision_request_status = "Revision draft cleared"
        context.window_manager.operating_line_revision_message = ""
        return {"FINISHED"}


class OPERATINGLINE_OT_submit_revision_request(bpy.types.Operator):
    bl_idname = "operating_line.submit_revision_request"
    bl_label = "Send Request"
    bl_description = (
        "Queue an immutable revision request for an external MCP planner; "
        "this does not change the scene"
    )

    def execute(self, context):
        companion = _companion()
        try:
            companion.submit_revision_request(
                context.window_manager.operating_line_revision_message
            )
        except ValueError as error:
            companion.revision_request_status = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        context.window_manager.operating_line_revision_message = ""
        self.report({"INFO"}, "Revision request queued; the scene was not changed")
        return {"FINISHED"}


class OPERATINGLINE_OT_load_older_revision_history(bpy.types.Operator):
    bl_idname = "operating_line.load_older_revision_history"
    bl_label = "Load Older Turns"
    bl_description = "Load the preceding page of this immutable revision thread"

    def execute(self, _context):
        companion = _companion()
        if companion.load_older_revision_history():
            self.report({"INFO"}, "Older revision turns requested")
            return {"FINISHED"}
        self.report({"INFO"}, companion.revision_history_error)
        return {"CANCELLED"}


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
    OPERATINGLINE_OT_accept_proposal,
    OPERATINGLINE_OT_reject_proposal,
    OPERATINGLINE_OT_reference_node,
    OPERATINGLINE_OT_clear_revision_request,
    OPERATINGLINE_OT_submit_revision_request,
    OPERATINGLINE_OT_load_older_revision_history,
    OPERATINGLINE_OT_start,
    OPERATINGLINE_OT_next,
    OPERATINGLINE_OT_back,
    OPERATINGLINE_OT_toggle_overlay,
    OPERATINGLINE_OT_toggle_branch,
)
