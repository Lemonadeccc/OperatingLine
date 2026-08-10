"""Operators exposing accepted-plan guidance and proposal review use cases."""

import bpy

from ..infrastructure import (
    disable_overlay,
    enable_overlay,
    overlay_enabled,
    remove_factory_startup_objects,
)
from .native_menu_guidance import (
    disable_native_menu_guidance,
    enable_native_menu_guidance,
    guided_menu_action_matches,
    interaction_guidance_snapshot,
    native_menu_snapshot,
    refresh_native_menu_guidance,
)


def _session():
    from .. import get_session

    return get_session()


def _companion():
    from .. import get_companion

    return get_companion()


def _execute_next(operator):
    """Run the canonical next action for both control and native-menu entry."""

    if _companion().proposed_plan is not None:
        message = "Accept or reject the pending plan proposal before continuing"
        operator.report({"WARNING"}, message)
        return {"CANCELLED"}
    session = _session()
    next_index = session.active_index + 1
    candidate = session.steps[next_index] if next_index < len(session.steps) else None
    try:
        step = session.next()
    except (OSError, RuntimeError, ValueError) as error:
        _companion().report("error", step=candidate, error=str(error))
        operator.report({"ERROR"}, str(error))
        refresh_native_menu_guidance()
        return {"CANCELLED"}
    if step is None:
        operator.report({"INFO"}, "All demo steps are complete")
        refresh_native_menu_guidance()
        return {"CANCELLED"}
    _companion().report("step_succeeded", step=step)
    refresh_native_menu_guidance()
    return {"FINISHED"}


def _draw_provider_authorization(layout, provider, *, initial: bool) -> None:
    """Draw the shared per-call data and possible-charge disclosure."""
    layout.label(
        text=f"Authorize one run with {provider['displayName']}?",
        icon="QUESTION",
    )
    location = provider["dataHandling"]["executionLocation"]
    if location == "remote":
        layout.label(text="Data is sent to the selected remote provider", icon="URL")
        if initial:
            layout.label(
                text=(
                    "Sends your goal, ActionCatalog, and current state of "
                    "this exact Blender instance"
                )
            )
        else:
            layout.label(text="Sends your message, base Plan, and node references")
            layout.label(text="Also sends ActionCatalog and latest companion state")
        layout.label(text="The provider may charge for this call")
        layout.label(text="OperatingLine cannot estimate provider charges")
    else:
        layout.label(text="Local provider: no provider data transmission", icon="HOME")
        layout.label(text="The provider description may define local execution costs")
        layout.label(text="OperatingLine cannot estimate provider charges")
    layout.separator()
    layout.label(text="The runtime may create one review proposal")
    layout.label(text="It will not Accept, execute, or change the scene")
    layout.label(text="Retrying opens a new confirmation and uses a new run ID")


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
        enable_native_menu_guidance(_session)
        enable_overlay(_session, interaction_guidance_snapshot)
        _companion().report("walkthrough_started")
        return {"FINISHED"}


class OPERATINGLINE_OT_next(bpy.types.Operator):
    bl_idname = "operating_line.next"
    bl_label = "Next"
    bl_description = "Execute the next accepted plan step"
    bl_options = {"REGISTER"}

    def execute(self, _context):
        return _execute_next(self)


class OPERATINGLINE_OT_open_add_menu(bpy.types.Operator):
    bl_idname = "operating_line.open_add_menu"
    bl_label = "Open Guided Add Menu"
    bl_description = "Open Blender's native Add menu without changing the scene"
    bl_options = {"INTERNAL"}

    def execute(self, _context):
        result = bpy.ops.wm.call_menu("EXEC_DEFAULT", name="VIEW3D_MT_add")
        if result not in ({"INTERFACE"}, {"RUNNING_MODAL"}):
            self.report({"ERROR"}, "Blender could not open the native Add menu")
            return {"CANCELLED"}
        return {"FINISHED"}

    def invoke(self, context, _event):
        return self.execute(context)


class OPERATINGLINE_OT_guided_menu_action(bpy.types.Operator):
    bl_idname = "operating_line.guided_menu_action"
    bl_label = "Execute Guided Plan Step"
    bl_description = (
        "Execute this exact accepted leaf using its planned parameters and shared Back receipt"
    )
    bl_options = {"INTERNAL"}

    step_id: bpy.props.StringProperty()
    operator_id: bpy.props.StringProperty()

    def execute(self, _context):
        if not guided_menu_action_matches(self.step_id, self.operator_id):
            message = "This menu item does not match the accepted next step"
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        return _execute_next(self)


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
        refresh_native_menu_guidance()
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


class OPERATINGLINE_OT_submit_goal_request(bpy.types.Operator):
    bl_idname = "operating_line.submit_goal_request"
    bl_label = "Create Guidance"
    bl_description = (
        "Queue this goal for the runtime planner; no plan is accepted or executed"
    )

    def execute(self, context):
        companion = _companion()
        try:
            request = companion.submit_goal_request(
                context.window_manager.operating_line_goal
            )
        except ValueError as error:
            companion.goal_request.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        context.window_manager.operating_line_goal = ""
        self.report(
            {"INFO"},
            f"Goal request {request['requestId'][:8]} queued; scene unchanged",
        )
        return {"FINISHED"}


class OPERATINGLINE_OT_refresh_initial_plan_providers(bpy.types.Operator):
    bl_idname = "operating_line.refresh_initial_plan_providers"
    bl_label = "Refresh Initial Providers"
    bl_description = "Refresh initial planner descriptors from the loopback runtime"

    def execute(self, _context):
        companion = _companion()
        try:
            companion.refresh_initial_plan_providers()
        except ValueError as error:
            companion.initial_plan_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class OPERATINGLINE_OT_select_initial_plan_provider(bpy.types.Operator):
    bl_idname = "operating_line.select_initial_plan_provider"
    bl_label = "Select Initial Provider"
    bl_description = "Explicitly select this provider for a future confirmed initial run"

    provider_id: bpy.props.StringProperty()

    def execute(self, _context):
        companion = _companion()
        try:
            provider = companion.select_initial_plan_provider(self.provider_id)
        except ValueError as error:
            companion.initial_plan_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Selected {provider['displayName']}")
        return {"FINISHED"}


class OPERATINGLINE_OT_run_initial_plan_provider(bpy.types.Operator):
    bl_idname = "operating_line.run_initial_plan_provider"
    bl_label = "Confirm Initial Planner Run"
    bl_description = (
        "Authorize one initial planner run; its proposal still requires Accept or Reject"
    )

    def invoke(self, context, _event):
        handoff = _companion().initial_plan_handoff
        if not handoff.can_run:
            message = "Select an available provider after the runtime acknowledges the goal"
            handoff.message = message
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        self._confirmation_opened = True
        return context.window_manager.invoke_props_dialog(self, width=520)

    def draw(self, _context):
        provider = _companion().initial_plan_handoff.selected_provider
        if provider is None:
            self.layout.label(text="No provider selected", icon="ERROR")
            return
        _draw_provider_authorization(self.layout, provider, initial=True)

    def execute(self, _context):
        companion = _companion()
        if not getattr(self, "_confirmation_opened", False):
            message = "Open and confirm the initial planner authorization dialog first"
            companion.initial_plan_handoff.message = message
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        self._confirmation_opened = False
        try:
            request = companion.begin_initial_plan_run()
        except ValueError as error:
            companion.initial_plan_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report(
            {"INFO"},
            f"Initial planner run {request['generationRequestId'][:8]} queued; scene unchanged",
        )
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

    def execute(self, _context):
        companion = _companion()
        try:
            node = companion.add_revision_reference(
                self.scope,
                self.node_id,
            )
        except ValueError as error:
            companion.revision_request_status = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        companion.revision_request_status = (
            f"@{node.number} referenced; describe the change"
        )
        return {"FINISHED"}


class OPERATINGLINE_OT_remove_revision_reference(bpy.types.Operator):
    bl_idname = "operating_line.remove_revision_reference"
    bl_label = "Remove Reference"
    bl_description = "Remove this node from the local revision-request draft"

    node_id: bpy.props.StringProperty()

    def execute(self, _context):
        companion = _companion()
        if not companion.remove_revision_reference(self.node_id):
            self.report({"WARNING"}, "Revision reference is no longer selected")
            return {"CANCELLED"}
        companion.revision_request_status = "Reference removed; draft preserved"
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


class OPERATINGLINE_OT_refresh_replan_providers(bpy.types.Operator):
    bl_idname = "operating_line.refresh_replan_providers"
    bl_label = "Refresh Providers"
    bl_description = "Refresh public provider descriptors from the loopback runtime"

    def execute(self, _context):
        companion = _companion()
        try:
            companion.refresh_replan_providers()
        except ValueError as error:
            companion.provider_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class OPERATINGLINE_OT_select_replan_provider(bpy.types.Operator):
    bl_idname = "operating_line.select_replan_provider"
    bl_label = "Select Provider"
    bl_description = "Explicitly select this provider for a future confirmed run"

    provider_id: bpy.props.StringProperty()

    def execute(self, _context):
        companion = _companion()
        try:
            provider = companion.select_replan_provider(self.provider_id)
        except ValueError as error:
            companion.provider_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Selected {provider['displayName']}")
        return {"FINISHED"}


class OPERATINGLINE_OT_run_replan_provider(bpy.types.Operator):
    bl_idname = "operating_line.run_replan_provider"
    bl_label = "Confirm Provider Run"
    bl_description = (
        "Authorize one provider run; a created proposal still requires Accept or Reject"
    )

    def invoke(self, context, _event):
        handoff = _companion().provider_handoff
        if not handoff.can_run:
            message = (
                "Select an available provider after the runtime acknowledges the request"
            )
            handoff.message = message
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        self._confirmation_opened = True
        return context.window_manager.invoke_props_dialog(self, width=520)

    def draw(self, _context):
        handoff = _companion().provider_handoff
        provider = handoff.selected_provider
        layout = self.layout
        if provider is None:
            layout.label(text="No provider selected", icon="ERROR")
            return
        _draw_provider_authorization(layout, provider, initial=False)

    def execute(self, _context):
        companion = _companion()
        if not getattr(self, "_confirmation_opened", False):
            message = "Open and confirm the provider authorization dialog first"
            companion.provider_handoff.message = message
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        self._confirmation_opened = False
        try:
            request = companion.begin_replan_run()
        except ValueError as error:
            companion.provider_handoff.message = str(error)
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report(
            {"INFO"},
            f"Provider run {request['generationRequestId'][:8]} queued; scene unchanged",
        )
        return {"FINISHED"}


class OPERATINGLINE_OT_toggle_overlay(bpy.types.Operator):
    bl_idname = "operating_line.toggle_overlay"
    bl_label = "Show or Hide Guidance"
    bl_description = "Show or hide the viewport guidance, status, and task tree"

    def execute(self, context):
        if overlay_enabled():
            disable_native_menu_guidance()
            disable_overlay()
            context.window_manager.operating_line_overlay_enabled = False
        else:
            enable_native_menu_guidance(_session)
            enable_overlay(_session, interaction_guidance_snapshot)
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
    OPERATINGLINE_OT_submit_goal_request,
    OPERATINGLINE_OT_refresh_initial_plan_providers,
    OPERATINGLINE_OT_select_initial_plan_provider,
    OPERATINGLINE_OT_run_initial_plan_provider,
    OPERATINGLINE_OT_accept_proposal,
    OPERATINGLINE_OT_reject_proposal,
    OPERATINGLINE_OT_reference_node,
    OPERATINGLINE_OT_remove_revision_reference,
    OPERATINGLINE_OT_clear_revision_request,
    OPERATINGLINE_OT_submit_revision_request,
    OPERATINGLINE_OT_load_older_revision_history,
    OPERATINGLINE_OT_refresh_replan_providers,
    OPERATINGLINE_OT_select_replan_provider,
    OPERATINGLINE_OT_run_replan_provider,
    OPERATINGLINE_OT_start,
    OPERATINGLINE_OT_next,
    OPERATINGLINE_OT_open_add_menu,
    OPERATINGLINE_OT_guided_menu_action,
    OPERATINGLINE_OT_back,
    OPERATINGLINE_OT_toggle_overlay,
    OPERATINGLINE_OT_toggle_branch,
)
