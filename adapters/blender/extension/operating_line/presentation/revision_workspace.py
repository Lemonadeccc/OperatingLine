"""Native collapsible UI for revision composition, threads, and proposals."""

from unicodedata import east_asian_width


def _display_columns(value: str) -> int:
    return sum(
        2 if east_asian_width(character) in {"F", "W"} else 1
        for character in value
    )


def _wrap_history_message(value, max_columns: int = 24) -> list[str]:
    """Wrap complete text for Blender's narrow sidebar without dropping words."""
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
                character_width = 2 if east_asian_width(character) in {"F", "W"} else 1
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


def _draw_wrapped_text(layout, value, *, icon: str | None = None) -> None:
    for index, line in enumerate(_wrap_history_message(value)):
        if index == 0 and icon is not None:
            layout.label(text=line, icon=icon)
        else:
            layout.label(text=line)


def _reference_button(row, companion, *, scope: str, node_id: str):
    referenced = companion.has_revision_reference(scope, node_id)
    button = row.row(align=True)
    button.enabled = not referenced
    operator = button.operator(
        "operating_line.reference_node",
        text="Referenced" if referenced else "Ref",
        icon="CHECKMARK" if referenced else "LINKED",
    )
    operator.node_id = node_id
    operator.scope = scope


def draw_proposal_node(layout, node, companion, depth: int = 0) -> None:
    row = layout.row(align=True)
    if depth:
        row.separator(factor=float(depth))
    marker = "STEP" if node.action is not None else "GROUP"
    content = row.split(factor=0.72, align=True)
    content.label(text=f"{marker}  {node.number}  {node.title}")
    _reference_button(
        content,
        companion,
        scope="proposal",
        node_id=node.id,
    )
    for child in node.children:
        draw_proposal_node(layout, child, companion, depth + 1)


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
            _draw_wrapped_text(
                layout,
                f"{name}: {before_value} -> {after_value}",
            )


def _draw_plan_diff(layout, plan_diff) -> None:
    if plan_diff is None:
        layout.label(text="Initial full plan; no earlier revision", icon="INFO")
        return
    summary = plan_diff["summary"]
    _draw_wrapped_text(
        layout,
        (
            f"Changes +{summary['addedSteps']} -{summary['removedSteps']} "
            f"~{summary['updatedSteps']} moved {summary['movedSteps']}"
        ),
        icon="FILE_REFRESH",
    )
    if plan_diff["planChanges"]:
        fields = ", ".join(change["field"] for change in plan_diff["planChanges"])
        _draw_wrapped_text(layout, f"Plan fields: {fields}")
    for change in plan_diff["stepChanges"][:5]:
        snapshot = change.get("after") or change.get("before")
        kind = change["kind"].capitalize()
        detail = ""
        if change["kind"] == "updated":
            detail = ": " + ", ".join(item["field"] for item in change["changes"])
        _draw_wrapped_text(
            layout,
            f"{kind} @{snapshot['nodeNumber']} {snapshot['title']}{detail}",
        )
        if change["kind"] == "updated":
            for field_change in change["changes"]:
                if field_change["field"] == "action":
                    _draw_action_argument_diff(layout, field_change)
    remaining = len(plan_diff["stepChanges"]) - 5
    if remaining > 0:
        layout.label(text=f"... {remaining} more changed nodes")


def draw_proposal_review(layout, companion, active_session) -> None:
    """Draw the proposal decision gate inside the expanded workspace."""
    proposal = companion.proposed_plan
    proposal_session = companion.proposal_session
    if proposal is None or proposal_session is None:
        return

    review = layout.box()
    review_header = review.row()
    review_header.alert = True
    review_header.label(text="Review required", icon="QUESTION")
    review.label(text="Plan proposal", icon="INFO")
    review.label(text="Scene unchanged")
    _draw_wrapped_text(review, proposal_session.root.title)
    _draw_wrapped_text(
        review,
        f"{proposal_session.plan_id} r{proposal_session.revision}",
    )
    review.label(text=f"Target: {proposal['targetAdapterId']}")
    revision_request_id = proposal.get("revisionRequestId")
    if revision_request_id:
        review.label(text=f"Revision request: {revision_request_id[:8]}", icon="LINKED")
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
    decisions.enabled = not companion.provider_handoff.active
    accept = decisions.row(align=True)
    missing_verifiable_base = _proposal_accept_requires_verifiable_base(proposal)
    accept.enabled = not bool(active_session.receipts) and not missing_verifiable_base
    accept.operator("operating_line.accept_proposal", icon="CHECKMARK")
    decisions.operator("operating_line.reject_proposal", icon="CANCEL")
    if missing_verifiable_base:
        review.label(
            text="Accept requires a protocol 1.1 proposal with a verifiable base",
            icon="ERROR",
        )
    elif active_session.receipts:
        review.label(text="Use Back to reach the start before accepting", icon="ERROR")
    elif companion.provider_handoff.active:
        review.label(
            text="Wait for the active provider run before deciding",
            icon="TIME",
        )


def _proposal_accept_requires_verifiable_base(proposal) -> bool:
    return (
        proposal.get("revisionRequestId") is not None
        and not isinstance(proposal.get("planDiff"), dict)
    )


def _draw_revision_request(layout, context, companion) -> None:
    composer = layout.box()
    composer.label(text="New revision", icon="GREASEPENCIL")
    base = companion.revision_base_session
    references = companion.revision_reference_nodes()
    composer.label(text=f"References {len(references)} / 8", icon="LINKED")
    if base is None:
        composer.label(text="Click a task node's Ref button", icon="INFO")
    else:
        scope = companion.revision_reference_scope or "active"
        composer.label(text=f"Base: {scope}", icon="FILE_TICK")
        _draw_wrapped_text(composer, f"{base.plan_id} r{base.revision}")
        try:
            lineage = companion.revision_draft_lineage
        except ValueError as error:
            composer.label(text=str(error), icon="ERROR")
        else:
            if lineage is None:
                composer.label(text="New revision thread  turn 1", icon="ADD")
            else:
                composer.label(
                    text=f"Continue {lineage.thread_id[:8]}  turn {lineage.turn + 1}",
                    icon="LINKED",
                )

        for node in references:
            reference = composer.box()
            _draw_wrapped_text(
                reference,
                f"@{node.number}  {node.title}",
                icon="LINKED",
            )
            remove = reference.operator(
                "operating_line.remove_revision_reference",
                text="Remove Reference",
                icon="X",
            )
            remove.node_id = node.id

    composer.label(text="Requested change")
    composer.prop(
        context.window_manager,
        "operating_line_revision_message",
        text="",
    )
    clear = composer.row()
    clear.enabled = bool(base or context.window_manager.operating_line_revision_message)
    clear.operator(
        "operating_line.clear_revision_request",
        text="Clear",
        icon="X",
    )
    send = composer.row()
    send.enabled = (
        companion.connected
        and not companion.provider_handoff.active
        and bool(references)
        and bool(context.window_manager.operating_line_revision_message.strip())
    )
    send.operator(
        "operating_line.submit_revision_request",
        text="Send Request",
        icon="EXPORT",
    )
    _draw_wrapped_text(
        composer,
        "Request only; scene unchanged.",
        icon="INFO",
    )
    if companion.provider_handoff.active:
        _draw_wrapped_text(
            composer,
            "Wait for the active provider run before sending another request.",
            icon="TIME",
        )
    _draw_wrapped_text(
        composer,
        "Use an external MCP planner or the optional provider below.",
    )

    if companion.revision_request_status:
        _draw_wrapped_text(
            composer,
            companion.revision_request_status,
            icon="INFO",
        )
    elif not companion.connected:
        composer.label(text="Connect the runtime to send", icon="UNLINKED")


def _draw_provider_handoff(layout, companion) -> None:
    """Draw the optional, explicitly authorized provider-run gate."""
    handoff = companion.provider_handoff
    provider_box = layout.box()
    header = provider_box.row(align=True)
    header.label(text="Optional AI provider", icon="NETWORK_DRIVE")
    refresh = header.row(align=True)
    refresh.enabled = companion.connected and not handoff.active
    refresh.operator(
        "operating_line.refresh_replan_providers",
        text="",
        icon="FILE_REFRESH",
    )
    _draw_wrapped_text(
        provider_box,
        "Never automatic. Select a provider, then confirm each individual run.",
        icon="INFO",
    )

    if not companion.connected:
        provider_box.label(text="Connect the runtime to list providers", icon="UNLINKED")
        return
    if handoff.loading_providers:
        provider_box.label(text="Refreshing providers...", icon="TIME")
    elif not handoff.providers:
        provider_box.label(text="No replan provider configured", icon="INFO")

    for provider in handoff.providers:
        availability = provider["availability"]
        available = availability["available"]
        selected = provider["id"] == handoff.selected_provider_id
        item = provider_box.box()
        row = item.row(align=True)
        row.enabled = available and not handoff.active
        select = row.operator(
            "operating_line.select_replan_provider",
            text=provider["displayName"],
            icon="RADIOBUT_ON" if selected else "RADIOBUT_OFF",
            depress=selected,
        )
        select.provider_id = provider["id"]
        row.label(text=f"v{provider['version']}")
        _draw_wrapped_text(item, provider["description"])
        location = provider["dataHandling"]["executionLocation"]
        if location == "remote":
            _draw_wrapped_text(
                item,
                "Remote: provider-managed transmission and credentials.",
                icon="URL",
            )
        else:
            item.label(text="Local: no provider data transmission", icon="HOME")
        if not available:
            _draw_wrapped_text(
                item,
                str(availability.get("message", "Provider unavailable")),
                icon="ERROR",
            )

    selected = handoff.selected_provider
    if selected is not None:
        disclosure = provider_box.box()
        disclosure.label(text=f"Selected: {selected['displayName']}", icon="CHECKMARK")
        if selected["dataHandling"]["executionLocation"] == "remote":
            _draw_wrapped_text(
                disclosure,
                "A confirmed run sends the revision message, full base Plan, node "
                "references, ActionCatalog, and latest companion state.",
                icon="URL",
            )
            _draw_wrapped_text(
                disclosure,
                "The provider may charge. OperatingLine does not estimate provider fees.",
                icon="ERROR",
            )
        else:
            _draw_wrapped_text(
                disclosure,
                "The provider runs locally with no provider data transmission.",
                icon="HOME",
            )
            _draw_wrapped_text(
                disclosure,
                "Its description may define costs. OperatingLine cannot estimate fees.",
                icon="ERROR",
            )
        _draw_wrapped_text(
            disclosure,
            "No API key, model, or provider endpoint is stored by this Blender add-on.",
        )

    run = provider_box.row()
    run.enabled = handoff.can_run
    label = (
        "Confirm New Provider Run"
        if handoff.phase in {"needs_revision", "failed", "interrupted"}
        else "Confirm Provider Run"
    )
    run.operator("operating_line.run_replan_provider", text=label, icon="PLAY")
    if handoff.acknowledged_revision_request_id is None:
        _draw_wrapped_text(
            provider_box,
            "Send a revision request and wait for the runtime acknowledgement first.",
            icon="TIME",
        )
    if handoff.message:
        status_icon = (
            "ERROR"
            if handoff.phase in {"needs_revision", "failed", "interrupted"}
            else "INFO"
        )
        _draw_wrapped_text(provider_box, handoff.message, icon=status_icon)
    if handoff.needs_revision_summary:
        _draw_wrapped_text(
            provider_box,
            f"Validation: {handoff.needs_revision_summary}",
            icon="ERROR",
        )
        for finding in handoff.needs_revision_findings:
            _draw_wrapped_text(provider_box, f"- {finding}")
    if handoff.retry_mode == "never":
        _draw_wrapped_text(
            provider_box,
            "This run cannot be retried. Refresh the provider or create a new request.",
            icon="CANCEL",
        )
    if handoff.generation_request_id is not None:
        provider_box.label(
            text=f"Run {handoff.generation_request_id[:8]}  {handoff.phase}",
            icon="TIME" if handoff.active else "INFO",
        )
    _draw_wrapped_text(
        provider_box,
        "A proposal remains read-only until you choose Accept; no run executes it.",
    )


def _compact_history_message(value, limit: int = 76) -> str:
    rendered = " ".join(str(value).split())
    return rendered if len(rendered) <= limit else f"{rendered[: limit - 3]}..."


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
        "awaiting_proposal": ("Awaiting proposal", "TIME"),
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
            turn_box.label(
                text=f"Planner revision {proposal['plan']['revision']}",
                icon="FILE_REFRESH",
            )
            plan_diff = proposal.get("planDiff")
            if isinstance(plan_diff, dict):
                summary = plan_diff["summary"]
                turn_box.label(
                    text=(
                        f"Diff +{summary['addedSteps']} -{summary['removedSteps']} "
                        f"~{summary['updatedSteps']} moved {summary['movedSteps']}"
                    )
                )
            else:
                turn_box.label(text="No verifiable plan diff", icon="INFO")

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


def draw_revision_workspace(layout, context, companion, active_session) -> None:
    """Draw revision work before the independent viewport-guidance gate."""
    workspace = layout.box()
    references = companion.revision_reference_nodes()
    history = companion.revision_thread_history
    header = workspace.row(align=True)
    expanded = context.window_manager.operating_line_revision_workspace_expanded
    header.prop(
        context.window_manager,
        "operating_line_revision_workspace_expanded",
        text="",
        icon="DOWNARROW_HLT" if expanded else "RIGHTARROW",
        emboss=False,
    )
    header.alert = companion.proposed_plan is not None
    if expanded:
        header.label(text="Revision Workspace", icon="GREASEPENCIL")
    elif companion.proposed_plan is not None:
        header.label(text="Revisions: review", icon="QUESTION")
    elif references:
        header.label(text=f"Revisions: draft {len(references)}/8", icon="LINKED")
    elif history is not None:
        header.label(text=f"Revisions: turn {history['latestTurn']}", icon="TIME")
    else:
        header.label(text="Revision Workspace", icon="GREASEPENCIL")

    if not expanded:
        return

    draw_proposal_review(workspace, companion, active_session)
    _draw_revision_request(workspace, context, companion)
    _draw_provider_handoff(workspace, companion)
    _draw_revision_history(workspace, context, companion)
    if companion.proposal_session is not None:
        proposal_tree = workspace.box()
        proposal_tree.label(text="Proposed task tree (read-only)", icon="QUESTION")
        draw_proposal_node(
            proposal_tree,
            companion.proposal_session.root,
            companion,
        )


__all__ = ("draw_revision_workspace",)
