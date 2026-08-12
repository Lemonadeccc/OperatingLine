"""VIEW_3D sidebar composition for guidance and revision surfaces."""

import bpy

from ..application import GuidanceState, node_state
from ..infrastructure import native_history_error
from ..visual_theme import STATE_ICONS, STATE_SYMBOLS
from .revision_workspace import draw_revision_workspace, draw_wrapped_text


def _step_ordinal(index: int | None) -> str:
    return "--" if index is None else f"{index + 1:02d}"


def _draw_node(layout, node, session, companion, depth: int = 0) -> None:
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
    content = row.split(factor=0.72, align=True)
    content.label(
        text=f"{STATE_SYMBOLS[state]}  {node.number}  {node.title}",
        icon=STATE_ICONS[state],
    )
    referenced = companion.has_revision_reference("active", node.id)
    reference_row = content.row(align=True)
    reference_row.enabled = not referenced
    reference = reference_row.operator(
        "operating_line.reference_node",
        text="Referenced" if referenced else "Ref",
        icon="CHECKMARK" if referenced else "LINKED",
    )
    reference.node_id = node.id
    reference.scope = "active"
    if node.children and session.is_expanded(node.id):
        for child in node.children:
            _draw_node(layout, child, session, companion, depth + 1)


def _draw_walkthrough_controls(
    layout,
    session,
    *,
    proposal_pending: bool,
    history_error: str,
) -> None:
    start = layout.row()
    start.scale_y = 1.15
    start.enabled = not proposal_pending and not history_error
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
    back.enabled = active is not None and not history_error
    back.alert = active is not None
    back.operator(
        "operating_line.back",
        text=f"Back {_step_ordinal(session.active_index if active else None)}",
        icon=STATE_ICONS[GuidanceState.BACK] if active else "LOCKED",
    )
    forward = controls.row(align=True)
    forward.enabled = (
        next_step is not None
        and not proposal_pending
        and not session.observation_blocked
        and not history_error
    )
    forward.operator(
        "operating_line.next",
        text=f"{_step_ordinal(next_index if next_step else None)} Next",
        icon=STATE_ICONS[GuidanceState.NEXT] if next_step else "CHECKMARK",
    )

    gate = session.observation_gate
    if gate is not None and gate.status != "recovered":
        gate_box = layout.box()
        gate_box.alert = True
        gate_box.label(text="Observation success gate did not pass", icon="ERROR")
        draw_wrapped_text(gate_box, gate.message)
        if gate.blocking:
            strategy = (
                "Automatic rollback failed; repair the conflict or use Back"
                if gate.status == "rollback_failed"
                else "Scene retained for repair; recheck before continuing or use Back"
            )
            draw_wrapped_text(gate_box, strategy, icon="RECOVER_LAST")
            recheck = gate_box.row()
            recheck.enabled = not history_error
            recheck.operator(
                "operating_line.recheck_observations",
                text="Recheck Observations",
                icon="FILE_REFRESH",
            )
        else:
            draw_wrapped_text(
                gate_box,
                "The failed step was rolled back. Next retries the same step.",
                icon="LOOP_BACK",
            )


def _draw_guidance_status(layout, session) -> None:
    active = session.active_step
    next_index = session.active_index + 1
    next_step = session.steps[next_index] if next_index < len(session.steps) else None

    status = layout.box()
    status.label(
        text=f"Progress {len(session.completed_steps):02d} / {len(session.steps):02d}",
        icon="INFO",
    )
    if active is None:
        status.label(text="Back --  Nothing to roll back", icon="LOCKED")
    else:
        status.label(
            text=f"Back {session.active_index + 1:02d}  {active.title}",
            icon=STATE_ICONS[GuidanceState.BACK],
        )
    if session.observation_blocked:
        status.label(
            text=f"Next {next_index + 1:02d}  Locked by observation gate",
            icon="LOCKED",
        )
    elif next_step is None:
        status.label(text="Next --  Walkthrough complete", icon="CHECKMARK")
    else:
        status.label(
            text=f"Next {next_index + 1:02d}  {next_step.title}",
            icon=STATE_ICONS[GuidanceState.NEXT],
        )


def _draw_initial_plan_handoff(layout, companion) -> None:
    handoff = companion.initial_plan_handoff
    provider_box = layout.box()
    header = provider_box.row(align=True)
    header.label(text="Optional initial AI planner", icon="NETWORK_DRIVE")
    refresh = header.row(align=True)
    refresh.enabled = companion.connected and not handoff.active
    refresh.operator(
        "operating_line.refresh_initial_plan_providers",
        text="",
        icon="FILE_REFRESH",
    )
    draw_wrapped_text(
        provider_box,
        "Never automatic. Refresh, select a provider, then confirm each run.",
        icon="INFO",
    )
    if handoff.loading_providers:
        provider_box.label(text="Refreshing providers...", icon="TIME")
    elif not handoff.providers:
        provider_box.label(text="No initial provider loaded", icon="INFO")
    for provider in handoff.providers:
        availability = provider["availability"]
        available = availability["available"]
        selected = provider["id"] == handoff.selected_provider_id
        item = provider_box.box()
        row = item.row(align=True)
        row.enabled = available and not handoff.active
        select = row.operator(
            "operating_line.select_initial_plan_provider",
            text=provider["displayName"],
            icon="RADIOBUT_ON" if selected else "RADIOBUT_OFF",
            depress=selected,
        )
        select.provider_id = provider["id"]
        row.label(text=f"v{provider['version']}")
        draw_wrapped_text(item, provider["description"])
        location = provider["dataHandling"]["executionLocation"]
        if location == "remote":
            draw_wrapped_text(
                item,
                (
                    "Remote: goal, ActionCatalog, and this exact Blender instance "
                    "state are transmitted."
                ),
                icon="URL",
            )
        else:
            item.label(text="Local: no provider data transmission", icon="HOME")
        if not available:
            draw_wrapped_text(
                item,
                str(availability.get("message", "Provider unavailable")),
                icon="ERROR",
            )
    selected = handoff.selected_provider
    if selected is not None:
        disclosure = provider_box.box()
        disclosure.label(text=f"Selected: {selected['displayName']}", icon="CHECKMARK")
        if selected["dataHandling"]["executionLocation"] == "remote":
            draw_wrapped_text(
                disclosure,
                (
                    "A confirmed run sends this goal, the ActionCatalog, and current "
                    "state of this exact Blender instance."
                ),
                icon="URL",
            )
        else:
            disclosure.label(
                text="Provider runs locally with no provider transmission",
                icon="HOME",
            )
        draw_wrapped_text(
            disclosure,
            "The provider may charge. OperatingLine cannot estimate provider fees.",
            icon="ERROR",
        )
        draw_wrapped_text(
            disclosure,
            "No API key, model, or provider endpoint is stored by this Blender add-on.",
        )
    run = provider_box.row()
    run.enabled = handoff.can_run and companion.proposed_plan is None
    label = (
        "Confirm New Initial Run"
        if handoff.phase in {"needs_revision", "failed", "interrupted"}
        else "Confirm Initial Planner Run"
    )
    run.operator("operating_line.run_initial_plan_provider", text=label, icon="PLAY")
    if handoff.message:
        icon = (
            "ERROR"
            if handoff.phase in {"needs_revision", "failed", "interrupted"}
            else "INFO"
        )
        draw_wrapped_text(provider_box, handoff.message, icon=icon)
    if handoff.needs_revision_summary:
        draw_wrapped_text(
            provider_box,
            f"Validation: {handoff.needs_revision_summary}",
            icon="ERROR",
        )
        for finding in handoff.needs_revision_findings:
            draw_wrapped_text(provider_box, f"- {finding}")
    if handoff.retry_mode == "never":
        draw_wrapped_text(
            provider_box,
            "This run cannot be retried. Refresh the provider or submit a new goal.",
            icon="CANCEL",
        )
    if handoff.generation_request_id is not None:
        provider_box.label(
            text=f"Run {handoff.generation_request_id[:8]}  {handoff.phase}",
            icon="TIME" if handoff.active else "INFO",
        )
    draw_wrapped_text(
        provider_box,
        "A created proposal still requires review; this run cannot Accept or execute it.",
        icon="LOCKED",
    )


def _draw_goal_workspace(layout, context, companion) -> None:
    if companion.goal_entry_blocked and not companion.goal_request.active:
        return
    workspace = layout.box()
    header = workspace.row(align=True)
    expanded = context.window_manager.operating_line_goal_workspace_expanded
    header.prop(
        context.window_manager,
        "operating_line_goal_workspace_expanded",
        text="",
        icon="DOWNARROW_HLT" if expanded else "RIGHTARROW",
        emboss=False,
    )
    header.label(text="Goal to Guidance", icon="LIGHT")
    if not expanded:
        if companion.goal_request.active:
            draw_wrapped_text(workspace, companion.goal_request.message, icon="TIME")
        return

    if companion.goal_request.active:
        icon = (
            "ERROR"
            if companion.goal_request.phase == "error"
            else "QUESTION"
            if companion.goal_request.phase == "proposal_received"
            else "TIME"
        )
        draw_wrapped_text(
            workspace,
            f"Goal: {companion.goal_request.goal_summary}",
            icon="GREASEPENCIL",
        )
        draw_wrapped_text(workspace, companion.goal_request.message, icon=icon)
        draw_wrapped_text(
            workspace,
            "Scene and active plan unchanged",
            icon="LOCKED",
        )
        if companion.goal_request.phase == "proposal_received":
            workspace.label(text="Review the full proposal below")
        elif companion.goal_request.acknowledged_request_id is not None:
            _draw_initial_plan_handoff(workspace, companion)
        return

    workspace.label(text="What do you want to accomplish?")
    workspace.prop(context.window_manager, "operating_line_goal", text="Goal")
    submit = workspace.row()
    goal = context.window_manager.operating_line_goal
    submit.enabled = companion.connected and bool(goal.strip())
    submit.operator("operating_line.submit_goal_request", icon="PLAY")
    if not companion.connected:
        workspace.label(text="Connect the runtime to send", icon="INFO")
    workspace.label(text="A proposal will require Accept or Reject", icon="LOCKED")


class OPERATINGLINE_PT_sidebar(bpy.types.Panel):
    bl_label = "OperatingLine"
    bl_idname = "OPERATINGLINE_PT_sidebar"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "OperatingLine"

    def draw(self, context):
        from .. import get_companion, get_session

        layout = self.layout
        session = get_session()
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

        _draw_goal_workspace(layout, context, companion)
        draw_revision_workspace(layout, context, companion, session)
        layout.prop(context.scene, "operating_line_replace_factory_scene")
        history_error = native_history_error()
        if history_error:
            history = layout.box()
            history.alert = True
            history.label(text="Native Undo history is out of sync", icon="ERROR")
            draw_wrapped_text(history, history_error)
            draw_wrapped_text(
                history,
                "Use Undo/Redo to return to a consistent checkpoint, or reload the file.",
                icon="RECOVER_LAST",
            )
        _draw_walkthrough_controls(
            layout,
            session,
            proposal_pending=companion.proposed_plan is not None,
            history_error=history_error,
        )

        overlay = layout.row()
        guidance_visible = context.window_manager.operating_line_overlay_enabled
        overlay.operator(
            "operating_line.toggle_overlay",
            text="Hide Guidance" if guidance_visible else "Show Guidance",
            icon="HIDE_OFF" if guidance_visible else "HIDE_ON",
        )

        if not guidance_visible:
            hidden = layout.box()
            hidden.label(
                text="Guidance hidden; walkthrough state preserved",
                icon="HIDE_ON",
            )
            return

        layout.separator()
        _draw_guidance_status(layout, session)
        tree = layout.box()
        tree.label(text="Active task tree", icon="OUTLINER")
        _draw_node(tree, session.root, session, companion)


CLASSES = (OPERATINGLINE_PT_sidebar,)
