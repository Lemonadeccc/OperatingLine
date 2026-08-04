"""Recursive VIEW_3D sidebar UI for OperatingLine plans."""

from unicodedata import east_asian_width

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
    content = row.split(factor=0.82, align=True)
    content.label(
        text=f"{STATE_SYMBOLS[state]}  {node.number}  {node.title}",
        icon=STATE_ICONS[state],
    )
    reference = content.operator(
        "operating_line.reference_node",
        text="Ref",
    )
    reference.node_id = node.id
    reference.scope = "active"
    if node.children and session.is_expanded(node.id):
        for child in node.children:
            _draw_node(layout, child, session, depth + 1)


def _draw_proposal_node(layout, node, depth: int = 0) -> None:
    row = layout.row(align=True)
    if depth:
        row.separator(factor=float(depth))
    marker = "STEP" if node.action is not None else "GROUP"
    content = row.split(factor=0.82, align=True)
    content.label(text=f"{marker}  {node.number}  {node.title}")
    reference = content.operator(
        "operating_line.reference_node",
        text="Ref",
    )
    reference.node_id = node.id
    reference.scope = "proposal"
    for child in node.children:
        _draw_proposal_node(layout, child, depth + 1)


def _compact_diff_value(value) -> str | None:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return f"{value:.6g}"
    if isinstance(value, (int, str)):
        rendered = str(value)
        return rendered if len(rendered) <= 32 else f"{rendered[:29]}..."
    if isinstance(value, list) and len(value) <= 3 and all(
        isinstance(item, (int, float, str, bool)) for item in value
    ):
        return str(value)
    return None


def _draw_action_argument_diff(layout, field_change) -> None:
    before = field_change.get("before")
    after = field_change.get("after")
    if not isinstance(before, dict) or not isinstance(after, dict):
        return
    before_arguments = before.get("arguments")
    after_arguments = after.get("arguments")
    if not isinstance(before_arguments, dict) or not isinstance(after_arguments, dict):
        return
    changed_names = sorted(
        name
        for name in set(before_arguments) | set(after_arguments)
        if before_arguments.get(name) != after_arguments.get(name)
    )
    for name in changed_names[:2]:
        before_value = _compact_diff_value(before_arguments.get(name))
        after_value = _compact_diff_value(after_arguments.get(name))
        if before_value is not None and after_value is not None:
            layout.label(text=f"    {name}: {before_value} -> {after_value}")


def _draw_plan_diff(layout, plan_diff) -> None:
    if plan_diff is None:
        layout.label(text="Initial full plan; no earlier revision", icon="INFO")
        return
    summary = plan_diff["summary"]
    layout.label(
        text=(
            f"Changes  +{summary['addedSteps']}  -{summary['removedSteps']}  "
            f"~{summary['updatedSteps']}  moved {summary['movedSteps']}"
        ),
        icon="FILE_REFRESH",
    )
    if plan_diff["planChanges"]:
        fields = ", ".join(change["field"] for change in plan_diff["planChanges"])
        layout.label(text=f"Plan fields: {fields}")
    for change in plan_diff["stepChanges"][:5]:
        snapshot = change.get("after") or change.get("before")
        kind = change["kind"].capitalize()
        detail = ""
        if change["kind"] == "updated":
            detail = ": " + ", ".join(item["field"] for item in change["changes"])
        layout.label(
            text=f"{kind} @{snapshot['nodeNumber']} {snapshot['title']}{detail}"
        )
        if change["kind"] == "updated":
            for field_change in change["changes"]:
                if field_change["field"] == "action":
                    _draw_action_argument_diff(layout, field_change)
    remaining = len(plan_diff["stepChanges"]) - 5
    if remaining > 0:
        layout.label(text=f"... {remaining} more changed nodes")


def _draw_proposal_summary(layout, companion, active_session) -> None:
    proposal = companion.proposed_plan
    proposal_session = companion.proposal_session
    if proposal is None or proposal_session is None:
        return

    review = layout.box()
    review_header = review.row()
    review_header.alert = True
    review_header.label(text="Plan proposal - review required", icon="QUESTION")
    review.label(text="No scene change has occurred", icon="INFO")
    review.label(text=proposal_session.root.title)
    review.label(
        text=f"{proposal_session.plan_id}  revision {proposal_session.revision}"
    )
    review.label(text=f"Target: {proposal['targetAdapterId']}")
    revision_request_id = proposal.get("revisionRequestId")
    if revision_request_id:
        review.label(
            text=f"Revision request: {revision_request_id[:8]}",
            icon="LINKED",
        )
    revision_thread = proposal.get("revisionThread")
    if revision_thread:
        review.label(
            text=(
                f"Thread {revision_thread['threadId'][:8]}  "
                f"turn {revision_thread['turn']}"
            ),
            icon="LINKED",
        )
    _draw_plan_diff(review, proposal.get("planDiff"))

    decisions = review.row(align=True)
    accept = decisions.row(align=True)
    accept.enabled = not bool(active_session.receipts)
    accept.operator("operating_line.accept_proposal", icon="CHECKMARK")
    decisions.operator("operating_line.reject_proposal", icon="CANCEL")
    if active_session.receipts:
        review.label(text="Use Back to reach the start before accepting", icon="ERROR")


def _draw_revision_request(layout, context, companion) -> None:
    composer = layout.box()
    composer.label(text="Revision request", icon="GREASEPENCIL")
    base = companion.revision_base_session
    references = companion.revision_reference_nodes()
    if base is None:
        composer.label(text="Click a node's link icon to reference it", icon="INFO")
    else:
        scope = companion.revision_reference_scope or "active"
        composer.label(
            text=f"Base: {scope} {base.plan_id} r{base.revision}",
            icon="FILE_TICK",
        )
        try:
            lineage = companion.revision_draft_lineage
        except ValueError as error:
            composer.label(text=str(error), icon="ERROR")
        else:
            if lineage is None:
                composer.label(text="New revision thread  turn 1", icon="ADD")
            else:
                composer.label(
                    text=(
                        f"Continue {lineage.thread_id[:8]}  "
                        f"turn {lineage.turn + 1}"
                    ),
                    icon="LINKED",
                )
        for node in references:
            composer.label(text=f"@{node.number}  {node.title}", icon="LINKED")

    composer.prop(
        context.window_manager,
        "operating_line_revision_message",
        text="Request",
    )
    controls = composer.row(align=True)
    clear = controls.row(align=True)
    clear.enabled = bool(base or context.window_manager.operating_line_revision_message)
    clear.operator("operating_line.clear_revision_request", icon="X")
    send = controls.row(align=True)
    send.enabled = (
        companion.connected
        and bool(references)
        and bool(context.window_manager.operating_line_revision_message.strip())
    )
    send.operator("operating_line.submit_revision_request", icon="EXPORT")

    if companion.revision_request_status:
        composer.label(text=companion.revision_request_status, icon="INFO")
    elif not companion.connected:
        composer.label(text="Connect the runtime to send", icon="UNLINKED")


def _compact_history_message(value, limit: int = 76) -> str:
    rendered = " ".join(str(value).split())
    return rendered if len(rendered) <= limit else f"{rendered[: limit - 3]}..."


def _display_columns(value: str) -> int:
    return sum(
        2 if east_asian_width(character) in {"F", "W"} else 1
        for character in value
    )


def _wrap_history_message(value, max_columns: int = 24) -> list[str]:
    """Wrap a complete revision message for Blender's narrow sidebar."""
    rendered = " ".join(str(value).split())
    if not rendered:
        return [""]

    lines: list[str] = []
    current = ""
    for word in rendered.split(" "):
        candidate = word if not current else f"{current} {word}"
        if _display_columns(candidate) <= max_columns:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ""
        while _display_columns(word) > max_columns:
            split_at = 0
            width = 0
            for character in word:
                character_width = (
                    2 if east_asian_width(character) in {"F", "W"} else 1
                )
                if width + character_width > max_columns:
                    break
                width += character_width
                split_at += 1
            lines.append(word[:split_at])
            word = word[split_at:]
        current = word
    if current:
        lines.append(current)
    return lines


def _draw_revision_history(layout, context, companion) -> None:
    history = companion.revision_thread_history
    if history is None:
        if companion.revision_history_error:
            warning = layout.box()
            warning.label(text="Revision history unavailable", icon="ERROR")
            warning.label(text=_compact_history_message(companion.revision_history_error))
        return

    history_box = layout.box()
    history_box.label(text="Revision history", icon="TIME")
    history_box.prop(
        context.window_manager,
        "operating_line_revision_history_expanded",
        text="Show all loaded turns",
    )
    turns = history["turns"]
    if turns:
        history_box.label(text=f"Thread {history['threadId'][:8]}", icon="LINKED")
        history_box.label(
            text=f"Turns {turns[0]['turn']}-{turns[-1]['turn']} / latest {history['latestTurn']}"
        )
    expanded = context.window_manager.operating_line_revision_history_expanded
    visible_turns = turns if expanded else turns[-3:]
    hidden_turns = len(turns) - len(visible_turns)
    if hidden_turns > 0:
        history_box.label(text=f"{hidden_turns} earlier loaded turns collapsed")

    state_presentation = {
        "awaiting_proposal": ("Waiting for planner", "TIME"),
        "awaiting_decision": ("Awaiting decision", "QUESTION"),
        "accepted": ("Accepted", "CHECKMARK"),
        "rejected": ("Rejected", "CANCEL"),
    }
    for record in visible_turns:
        label, icon = state_presentation[record["state"]]
        turn_box = history_box.box()
        turn_box.label(text=f"Turn {record['turn']}  {label}", icon=icon)
        references = " ".join(
            f"@{item['nodeNumber']}" for item in record["request"]["references"]
        )
        turn_box.label(text=f"You {references}", icon="GREASEPENCIL")
        for line in _wrap_history_message(record["request"]["message"]):
            turn_box.label(text=line)
        proposal = record["proposal"]
        if proposal is not None:
            summary = proposal["planDiff"]["summary"]
            turn_box.label(
                text=f"Planner revision {proposal['plan']['revision']}",
                icon="FILE_REFRESH",
            )
            turn_box.label(
                text=(
                    f"Diff +{summary['addedSteps']} -{summary['removedSteps']} "
                    f"~{summary['updatedSteps']} moved {summary['movedSteps']}"
                )
            )

    page = history["page"]
    if page["hasMore"]:
        load = history_box.row()
        load.enabled = companion.connected
        load.operator("operating_line.load_older_revision_history", icon="IMPORT")
    elif turns and turns[0]["turn"] == 1:
        history_box.label(text="Complete thread loaded", icon="CHECKMARK")
    if companion.revision_history_error:
        history_box.label(
            text=_compact_history_message(companion.revision_history_error),
            icon="INFO",
        )


def _draw_walkthrough_controls(layout, session, *, proposal_pending: bool) -> None:
    start = layout.row()
    start.scale_y = 1.15
    start.enabled = not proposal_pending
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
    forward.enabled = next_step is not None and not proposal_pending
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

        _draw_proposal_summary(layout, companion, session)
        _draw_revision_history(layout, context, companion)
        layout.prop(context.scene, "operating_line_replace_factory_scene")
        _draw_walkthrough_controls(
            layout,
            session,
            proposal_pending=companion.proposed_plan is not None,
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
            hidden.label(text="Guidance hidden; walkthrough state preserved", icon="HIDE_ON")
            return

        layout.separator()
        _draw_guidance_status(layout, session)
        _draw_revision_request(layout, context, companion)
        if companion.proposal_session is not None:
            proposal_tree = layout.box()
            proposal_tree.label(text="Proposed task tree (read-only)", icon="QUESTION")
            _draw_proposal_node(proposal_tree, companion.proposal_session.root)

        tree = layout.box()
        tree.label(text="Active task tree", icon="OUTLINER")
        _draw_node(tree, session.root, session)


CLASSES = (OPERATINGLINE_PT_sidebar,)
