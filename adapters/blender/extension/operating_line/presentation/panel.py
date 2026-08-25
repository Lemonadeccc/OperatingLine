"""VIEW_3D sidebar composition for guidance and revision surfaces."""

import bpy

from ..application import GuidanceState, node_state
from ..infrastructure import native_history_error
from ..visual_theme import STATE_ICONS, STATE_SYMBOLS
from .guided_control_dock import draw_guided_control_dock
from .revision_workspace import draw_revision_workspace, draw_wrapped_text


def _step_ordinal(index: int | None) -> str:
    return "--" if index is None else f"{index + 1:02d}"


def _leaf_guidance_snapshot(session, *, markers_visible: bool):
    """Keep leaf operations available even when editor markers are hidden."""

    from .native_menu_guidance import (
        interaction_guidance_snapshot,
        leaf_guidance_snapshot,
    )

    if markers_visible:
        snapshot = interaction_guidance_snapshot()
        if snapshot is not None:
            return snapshot
    return leaf_guidance_snapshot(session.guidance_step)


def _operation_parameter_text(operation) -> str | None:
    if not operation.parameters:
        return None
    return ", ".join(
        f"{parameter.name}={parameter.display_value}"
        for parameter in operation.parameters
    )


def _operation_connection_text(operation) -> str | None:
    connection = getattr(operation, "connection", None)
    if connection is None:
        return None
    return (
        f"{connection.from_node}.{connection.from_socket} → "
        f"{connection.to_node}.{connection.to_socket}"
    )


def _operation_reference_text(operation) -> str:
    trust = getattr(operation, "target_trust", None)
    trust_value = getattr(trust, "value", trust)
    if trust_value == "guided_control":
        return "GUIDED CONTROL · OperatingLine-owned proxy edits the same Blender data"
    if trust_value == "container_capable":
        return "CONTAINER CAPABLE · resolves only from the current receipt and visible node frame"
    if trust_value == "container_exact":
        return "CONTAINER EXACT · public node frame resolved; inner widget is not located"
    if trust_value == "profiled":
        return "PROFILED · verified only for the recorded Blender UI profile"
    if trust_value == "vision_candidate":
        return "VISION CANDIDATE · approximate target; execution proof required"
    if operation.target_kind == "node":
        return "REFERENCE ONLY · exact node frame resolves only when receipt-bound"
    if getattr(operation, "container_target_id", None) is not None:
        return "REFERENCE ONLY · container node known; exact parameter control unavailable"
    if getattr(operation, "connection", None) is not None:
        return "REFERENCE ONLY · socket endpoints known; exact UI coordinates unavailable"
    return "REFERENCE ONLY · UI target unavailable"


def _draw_leaf_operations(layout, session, snapshot) -> None:
    """Render the current-leaf identity before its expanded tree detail."""

    leaf = session.guidance_step
    box = layout.box()
    box.label(text="Current leaf operations", icon="PRESET")
    if leaf is None:
        box.label(text="Walkthrough complete", icon="CHECKMARK")
        return

    box.label(text=f"{leaf.number}  {leaf.title}", icon="OUTLINER_DATA_EMPTY")
    if snapshot is None:
        override = getattr(leaf, "execution_track_override", None)
        message = (
            "Selected track is bound, but its exact operation array is unavailable "
            "in this GuidePlan"
            if override is not None
            else "Leaf operation track unavailable for this accepted action"
        )
        draw_wrapped_text(
            box,
            message,
            icon="LOCKED",
        )
        return

    box.label(
        text=f"Leaf steps 01–{len(snapshot.operations):02d}",
        icon="SEQ_STRIP_DUPLICATE",
    )
    draw_wrapped_text(box, f"Track: {snapshot.title}")
    if getattr(snapshot, "candidate_only", False):
        box.label(text="CANDIDATE ONLY", icon="ERROR")
        draw_wrapped_text(
            box,
            "Native in-place operation · not equivalent to the managed action.",
            icon="INFO",
        )
        draw_wrapped_text(
            box,
            "No managed receipt and no managed replacement mesh are created.",
            icon="LOCKED",
        )
        if snapshot.reason:
            draw_wrapped_text(box, snapshot.reason)
    focused = snapshot.focused_operation
    box.label(
        text=(
            f"Instruction {snapshot.focused_ordinal:02d} / "
            f"{len(snapshot.operations):02d}  {focused.label}"
        ),
        icon=STATE_ICONS[focused.state],
    )
    navigation = box.row(align=True)
    back = navigation.row(align=True)
    back.enabled = snapshot.can_focus_back
    back_action = back.operator(
        "operating_line.leaf_operation_back",
        text=(
            f"{snapshot.focused_ordinal - 1:02d} Back"
            if snapshot.can_focus_back
            else "-- Back"
        ),
        icon="TRIA_LEFT" if snapshot.can_focus_back else "LOCKED",
    )
    back_action.step_id = snapshot.step_id
    back_action.operation_id = focused.operation_id
    back_action.ordinal = snapshot.focused_ordinal
    back_action.cursor_token = snapshot.cursor_token
    retry = navigation.operator(
        "operating_line.leaf_operation_retry",
        text=f"Retry {snapshot.focused_ordinal:02d}",
        icon="FILE_REFRESH",
    )
    retry.step_id = snapshot.step_id
    retry.operation_id = focused.operation_id
    retry.ordinal = snapshot.focused_ordinal
    retry.cursor_token = snapshot.cursor_token
    forward = navigation.row(align=True)
    forward.enabled = snapshot.can_focus_next
    next_action = forward.operator(
        "operating_line.leaf_operation_next",
        text=(
            f"{snapshot.focused_ordinal + 1:02d} Next"
            if snapshot.can_focus_next
            else "Next --"
        ),
        icon="TRIA_RIGHT" if snapshot.can_focus_next else "LOCKED",
    )
    next_action.step_id = snapshot.step_id
    next_action.operation_id = focused.operation_id
    next_action.ordinal = snapshot.focused_ordinal
    next_action.cursor_token = snapshot.cursor_token
    if snapshot.retry_serial:
        box.label(
            text=(
                f"Retry request {snapshot.retry_serial:02d} re-highlighted "
                f"instruction {snapshot.focused_ordinal:02d}"
            ),
            icon="FILE_REFRESH",
        )
    draw_wrapped_text(
        box,
        "Instruction controls only; global Execute and Back stay separate.",
        icon="INFO",
    )


def _draw_node(
    layout,
    node,
    session,
    companion,
    depth: int = 0,
    *,
    leaf_snapshot=None,
) -> None:
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
            _draw_node(
                layout,
                child,
                session,
                companion,
                depth + 1,
                leaf_snapshot=leaf_snapshot,
            )
    elif (
        not node.children
        and leaf_snapshot is not None
        and leaf_snapshot.step_id == node.id
    ):
        for operation in leaf_snapshot.operations:
            operation_row = layout.row(align=True)
            operation_row.separator(factor=float(depth + 1))
            parameter_text = _operation_parameter_text(operation)
            connection_text = _operation_connection_text(operation)
            operation_row.label(
                text=f"{operation.ordinal:02d}  {operation.label}",
                icon=STATE_ICONS[operation.state],
            )
            if parameter_text is not None:
                parameter_row = layout.row()
                parameter_row.separator(factor=float(depth + 2))
                draw_wrapped_text(parameter_row.column(), parameter_text)
            if connection_text is not None:
                connection_row = layout.row()
                connection_row.separator(factor=float(depth + 2))
                draw_wrapped_text(connection_row.column(), connection_text)
            if operation.reference:
                reference_row = layout.row()
                reference_row.separator(factor=float(depth + 2))
                draw_wrapped_text(
                    reference_row.column(),
                    _operation_reference_text(operation),
                    icon="LOCKED",
                )
            evidence = getattr(operation, "evidence", None)
            if evidence is not None and getattr(evidence, "value", evidence) != "none":
                evidence_row = layout.row()
                evidence_row.separator(factor=float(depth + 2))
                evidence_row.label(
                    text=f"HOST EVIDENCE · {getattr(evidence, 'value', evidence).upper()}",
                    icon="CHECKMARK",
                )


def _draw_walkthrough_controls(
    layout,
    session,
    companion,
    *,
    proposal_pending: bool,
    history_error: str,
) -> None:
    pending_leaf_run = getattr(session, "pending_leaf_operation_run", None)
    start = layout.row()
    start.scale_y = 1.15
    start.enabled = (
        not proposal_pending and not history_error and pending_leaf_run is None
    )
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
    back.enabled = (
        active is not None and not history_error and pending_leaf_run is None
    )
    back.alert = active is not None
    back.operator(
        "operating_line.back",
        text=f"Back {_step_ordinal(session.active_index if active else None)}",
        icon=STATE_ICONS[GuidanceState.BACK] if active else "LOCKED",
    )
    forward = controls.row(align=True)
    forward.enabled = (
        next_step is not None
        and getattr(next_step, "execution_track_override", None) is None
        and getattr(next_step, "candidate_menu_projection", None) is None
        and not proposal_pending
        and not session.observation_blocked
        and not history_error
        and pending_leaf_run is None
    )
    forward.operator(
        "operating_line.next",
        text=f"{_step_ordinal(next_index if next_step else None)} Next",
        icon=STATE_ICONS[GuidanceState.NEXT] if next_step else "CHECKMARK",
    )
    if (
        next_step is not None
        and getattr(next_step, "execution_track_override", None) is not None
    ):
        verify = layout.row()
        verify.scale_y = 1.15
        verify.enabled = (
            companion.connected
            and not proposal_pending
            and companion.execution_track_preflight_request is None
        )
        verify.operator(
            "operating_line.verify_execution_track",
            text=f"Verify Track {_step_ordinal(next_index)}",
            icon="VIEWZOOM",
        )
        if companion.execution_track_preflight_message:
            draw_wrapped_text(
                layout,
                companion.execution_track_preflight_message,
                icon="INFO",
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
    if (
        next_step is not None
        and getattr(next_step, "execution_track_override", None) is not None
    ):
        status.label(
            text=(
                f"Next {next_index + 1:02d}  Locked: "
                "use reviewed execution-track MCP"
            ),
            icon="LOCKED",
        )
    elif session.observation_blocked:
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


def _draw_guidance_tree_surface(
    layout,
    session,
    companion,
    *,
    context,
    markers_visible: bool,
) -> None:
    """Keep the current leaf and accepted tree consistent in every editor."""

    _draw_guidance_status(layout, session)
    leaf_snapshot = _leaf_guidance_snapshot(
        session,
        markers_visible=markers_visible,
    )
    _draw_leaf_operations(layout, session, leaf_snapshot)
    draw_guided_control_dock(
        layout,
        session.guidance_step,
        leaf_snapshot,
        draw_wrapped_text,
        operation_run=getattr(session, "pending_leaf_operation_run", None),
        native_targeting_supported=callable(
            getattr(
                getattr(context, "window_manager", None),
                "try_activate_rna_button",
                None,
            )
        ),
        receipt_available=(
            session.guidance_step is not None
            and (
                session.receipt_for_step(session.guidance_step.id)
                if callable(getattr(session, "receipt_for_step", None))
                else getattr(session, "receipts", {}).get(session.guidance_step.id)
            )
            is not None
        ),
    )
    tree = layout.box()
    tree.label(text="Active task tree", icon="OUTLINER")
    _draw_node(
        tree,
        session.root,
        session,
        companion,
        leaf_snapshot=leaf_snapshot,
    )


def _draw_initial_plan_handoff(layout, companion) -> None:
    del companion
    provider_box = layout.box()
    provider_box.label(text="Optional initial AI planner", icon="NETWORK_DRIVE")
    draw_wrapped_text(
        provider_box,
        "Unavailable: signed packet-bound Provider authority is not implemented for initial planning.",
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
            companion,
            proposal_pending=companion.proposed_plan is not None,
            history_error=history_error,
        )

        overlay = layout.row()
        guidance_visible = context.window_manager.operating_line_overlay_enabled
        overlay.operator(
            "operating_line.toggle_overlay",
            text="Hide Markers" if guidance_visible else "Show Markers",
            icon="HIDE_OFF" if guidance_visible else "HIDE_ON",
        )

        if not guidance_visible:
            hidden = layout.box()
            hidden.label(
                text="Markers hidden; leaf steps and tree remain visible",
                icon="HIDE_ON",
            )

        layout.separator()
        _draw_guidance_tree_surface(
            layout,
            session,
            companion,
            context=context,
            markers_visible=guidance_visible,
        )

        _draw_goal_workspace(layout, context, companion)
        draw_revision_workspace(layout, context, companion, session)


class _OPERATINGLINE_PT_editor_guidance:
    """Compact tree dock shared by Blender editors with an N-region."""

    bl_label = "OperatingLine Guidance"
    bl_region_type = "UI"
    bl_category = "OperatingLine"

    def draw(self, context):
        from .. import get_companion, get_session

        session = get_session()
        companion = get_companion()
        layout = self.layout
        layout.label(text="Tree and leaf operations", icon="OUTLINER")
        if self.bl_space_type != "VIEW_3D":
            layout.label(
                text="Markers require a verified target resolver",
                icon="INFO",
            )
        _draw_guidance_tree_surface(
            layout,
            session,
            companion,
            context=context,
            markers_visible=context.window_manager.operating_line_overlay_enabled,
        )


class _OPERATINGLINE_PT_properties_guidance:
    """Tree dock shared by the Properties editor's supported contexts."""

    bl_label = "OperatingLine Guidance"
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"

    def draw(self, context):
        from .. import get_companion, get_session

        layout = self.layout
        layout.label(text="Tree and leaf operations", icon="OUTLINER")
        layout.label(
            text="Markers require a verified target resolver",
            icon="INFO",
        )
        _draw_guidance_tree_surface(
            layout,
            get_session(),
            get_companion(),
            context=context,
            markers_visible=context.window_manager.operating_line_overlay_enabled,
        )


class OPERATINGLINE_PT_node_editor_guidance(
    _OPERATINGLINE_PT_editor_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_node_editor_guidance"
    bl_space_type = "NODE_EDITOR"


class OPERATINGLINE_PT_image_editor_guidance(
    _OPERATINGLINE_PT_editor_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_image_editor_guidance"
    bl_space_type = "IMAGE_EDITOR"


class OPERATINGLINE_PT_dopesheet_editor_guidance(
    _OPERATINGLINE_PT_editor_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_dopesheet_editor_guidance"
    bl_space_type = "DOPESHEET_EDITOR"


class OPERATINGLINE_PT_graph_editor_guidance(
    _OPERATINGLINE_PT_editor_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_graph_editor_guidance"
    bl_space_type = "GRAPH_EDITOR"


class OPERATINGLINE_PT_nla_editor_guidance(
    _OPERATINGLINE_PT_editor_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_nla_editor_guidance"
    bl_space_type = "NLA_EDITOR"


class OPERATINGLINE_PT_sequence_editor_guidance(
    _OPERATINGLINE_PT_editor_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_sequence_editor_guidance"
    bl_space_type = "SEQUENCE_EDITOR"


class OPERATINGLINE_PT_properties_object_guidance(
    _OPERATINGLINE_PT_properties_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_properties_object_guidance"
    bl_context = "object"


class OPERATINGLINE_PT_properties_modifier_guidance(
    _OPERATINGLINE_PT_properties_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_properties_modifier_guidance"
    bl_context = "modifier"


class OPERATINGLINE_PT_properties_data_guidance(
    _OPERATINGLINE_PT_properties_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_properties_data_guidance"
    bl_context = "data"


class OPERATINGLINE_PT_properties_material_guidance(
    _OPERATINGLINE_PT_properties_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_properties_material_guidance"
    bl_context = "material"


class OPERATINGLINE_PT_properties_render_guidance(
    _OPERATINGLINE_PT_properties_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_properties_render_guidance"
    bl_context = "render"


class OPERATINGLINE_PT_properties_output_guidance(
    _OPERATINGLINE_PT_properties_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_properties_output_guidance"
    bl_context = "output"


class OPERATINGLINE_PT_properties_world_guidance(
    _OPERATINGLINE_PT_properties_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_properties_world_guidance"
    bl_context = "world"


class OPERATINGLINE_PT_properties_scene_guidance(
    _OPERATINGLINE_PT_properties_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_properties_scene_guidance"
    bl_context = "scene"


class OPERATINGLINE_PT_properties_constraint_guidance(
    _OPERATINGLINE_PT_properties_guidance,
    bpy.types.Panel,
):
    bl_idname = "OPERATINGLINE_PT_properties_constraint_guidance"
    bl_context = "constraint"


class OPERATINGLINE_PT_outliner_guidance_popover(bpy.types.Panel):
    """Popover used because the Outliner has no N-region sidebar."""

    bl_label = "OperatingLine Guidance"
    bl_idname = "OPERATINGLINE_PT_outliner_guidance_popover"
    bl_space_type = "OUTLINER"
    bl_region_type = "HEADER"

    def draw(self, context):
        from .. import get_companion, get_session

        layout = self.layout
        layout.label(text="Tree and leaf operations", icon="OUTLINER")
        layout.label(
            text="Outliner guidance opens from this header popover",
            icon="INFO",
        )
        _draw_guidance_tree_surface(
            layout,
            get_session(),
            get_companion(),
            context=context,
            markers_visible=context.window_manager.operating_line_overlay_enabled,
        )


def _draw_outliner_header_entry(self, _context) -> None:
    self.layout.popover(
        panel=OPERATINGLINE_PT_outliner_guidance_popover.bl_idname,
        text="OperatingLine",
        icon="OUTLINER",
    )


_outliner_header_entry_registered = False


def register_outliner_header_entry() -> None:
    """Append the Outliner popover exactly once for this module instance."""

    global _outliner_header_entry_registered
    if _outliner_header_entry_registered:
        return
    header = getattr(bpy.types, "OUTLINER_HT_header", None)
    if header is None:
        return
    header.append(_draw_outliner_header_entry)
    _outliner_header_entry_registered = True


def unregister_outliner_header_entry() -> None:
    """Remove the Outliner popover callback after a confirmed registration."""

    global _outliner_header_entry_registered
    if not _outliner_header_entry_registered:
        return
    header = getattr(bpy.types, "OUTLINER_HT_header", None)
    if header is None:
        raise RuntimeError(
            "Cannot unregister OperatingLine Outliner guidance: "
            "OUTLINER_HT_header is unavailable"
        )
    header.remove(_draw_outliner_header_entry)
    _outliner_header_entry_registered = False


CLASSES = (
    OPERATINGLINE_PT_sidebar,
    OPERATINGLINE_PT_node_editor_guidance,
    OPERATINGLINE_PT_image_editor_guidance,
    OPERATINGLINE_PT_dopesheet_editor_guidance,
    OPERATINGLINE_PT_graph_editor_guidance,
    OPERATINGLINE_PT_nla_editor_guidance,
    OPERATINGLINE_PT_sequence_editor_guidance,
    OPERATINGLINE_PT_properties_object_guidance,
    OPERATINGLINE_PT_properties_modifier_guidance,
    OPERATINGLINE_PT_properties_data_guidance,
    OPERATINGLINE_PT_properties_material_guidance,
    OPERATINGLINE_PT_properties_render_guidance,
    OPERATINGLINE_PT_properties_output_guidance,
    OPERATINGLINE_PT_properties_world_guidance,
    OPERATINGLINE_PT_properties_scene_guidance,
    OPERATINGLINE_PT_properties_constraint_guidance,
    OPERATINGLINE_PT_outliner_guidance_popover,
)
