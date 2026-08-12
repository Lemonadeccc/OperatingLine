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


def draw_wrapped_text(layout, value, *, icon: str | None = None) -> None:
    """Draw wrapped text consistently across narrow Sidebar surfaces."""
    _draw_wrapped_text(layout, value, icon=icon)


def _reference_button(row, companion, *, scope: str, node_id: str):
    referenced = companion.has_revision_reference(scope, node_id)
    button = row.row(align=True)
    button.enabled = not referenced and not companion.dialogue_handoff.blocks_plan_work
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


def _parameter_value(value) -> str:
    compact = _compact_diff_value(value)
    if compact is not None:
        return compact
    if isinstance(value, list):
        return f"[{len(value)} items]"
    if isinstance(value, dict):
        return f"{{{len(value)} fields}}"
    return type(value).__name__


def _draw_parameter_form(layout, companion, node) -> None:
    if node.action is None:
        return
    fields = companion.revision_parameter_fields(node.id)
    if not fields:
        return
    form = layout.box()
    form.label(text="Parameter form", icon="PREFERENCES")
    form.label(text=node.action.name)
    for field in fields:
        row = form.row(align=True)
        row.enabled = not companion.dialogue_handoff.blocks_plan_work
        changed = field.value != field.original_value
        row.label(
            text=(
                f"{field.name}: {_parameter_value(field.original_value)} -> "
                f"{_parameter_value(field.value)}"
                if changed
                else f"{field.name}: {_parameter_value(field.value)}"
            ),
            icon="FILE_REFRESH" if changed else "DOT",
        )
        if field.editable:
            edit = row.operator(
                "operating_line.edit_revision_parameter",
                text="Edit",
                icon="GREASEPENCIL",
            )
            edit.node_id = node.id
            edit.argument_name = field.name
            if changed:
                reset = row.operator(
                    "operating_line.reset_revision_parameter",
                    text="",
                    icon="LOOP_BACK",
                )
                reset.node_id = node.id
                reset.argument_name = field.name
        else:
            row.label(text="Read-only", icon="LOCKED")


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
    revision_operation = proposal.get("revisionOperation")
    if revision_operation is not None:
        kind = revision_operation["kind"]
        if kind == "revise":
            review.label(text="Operation: revise", icon="GREASEPENCIL")
        else:
            review.label(
                text=(
                    f"Operation: {kind} from "
                    f"{revision_operation['sourceThreadId'][:8]}"
                ),
                icon="FILE_REFRESH" if kind == "merge" else "ADD",
            )
    merge_base_request_id = proposal.get("mergeBaseRequestId")
    if merge_base_request_id is not None:
        review.label(
            text=f"Merge base: {merge_base_request_id[:8]}",
            icon="FILE_TICK",
        )
    _draw_plan_diff(review, proposal.get("planDiff"))

    decisions = review.row(align=True)
    decisions.enabled = not (
        companion.provider_handoff.active
        or companion.initial_plan_handoff.active
        or companion.dialogue_handoff.active
    )
    accept = decisions.row(align=True)
    missing_verifiable_base = _proposal_accept_requires_verifiable_base(proposal)
    accept.enabled = not bool(active_session.receipts) and not missing_verifiable_base
    accept.operator("operating_line.accept_proposal", icon="CHECKMARK")
    decisions.operator("operating_line.reject_proposal", icon="CANCEL")
    if missing_verifiable_base:
        review.label(
            text="Accept requires a protocol 1.1+ proposal with a verifiable base",
            icon="ERROR",
        )
    elif active_session.receipts:
        review.label(text="Use Back to reach the start before accepting", icon="ERROR")
    elif (
        companion.provider_handoff.active
        or companion.initial_plan_handoff.active
        or companion.dialogue_handoff.active
    ):
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
    operation_kind = companion.revision_operation_kind
    if operation_kind == "fork":
        source_thread_id = companion.revision_source_thread_id
        composer.label(
            text=(
                "Fork mode"
                if source_thread_id is None
                else f"Fork from {source_thread_id[:8]}"
            ),
            icon="ADD",
        )
    elif operation_kind == "merge":
        source_thread_id = companion.revision_source_thread_id
        composer.label(
            text=(
                "Merge mode"
                if source_thread_id is None
                else f"Merge from {source_thread_id[:8]}"
            ),
            icon="FILE_REFRESH",
        )
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
            if operation_kind == "fork":
                composer.label(text="New branch  turn 1", icon="ADD")
            elif lineage is None:
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
            remove_row = reference.row()
            remove_row.enabled = not companion.dialogue_handoff.blocks_plan_work
            remove = remove_row.operator(
                "operating_line.remove_revision_reference",
                text="Remove Reference",
                icon="X",
            )
            remove.node_id = node.id
            _draw_parameter_form(reference, companion, node)

    composer.label(text="Requested change (optional with form edits)")
    composer.prop(
        context.window_manager,
        "operating_line_revision_message",
        text="",
    )
    clear = composer.row()
    clear.enabled = (
        not companion.dialogue_handoff.blocks_plan_work
        and bool(
            base
            or companion.revision_parameter_edit_count
            or operation_kind != "revise"
            or context.window_manager.operating_line_revision_message
        )
    )
    clear.operator(
        "operating_line.clear_revision_request",
        text="Clear",
        icon="X",
    )
    send = composer.row()
    send.enabled = (
        companion.connected
        and not companion.goal_request.active
        and not companion.provider_handoff.active
        and not companion.dialogue_handoff.blocks_plan_work
        and bool(references)
        and bool(
            context.window_manager.operating_line_revision_message.strip()
            or companion.revision_parameter_edit_count
        )
    )
    send_label = {
        "fork": "Send Fork Request",
        "merge": "Send Merge Request",
    }.get(operation_kind, "Send Request")
    send.operator(
        "operating_line.submit_revision_request",
        text=send_label,
        icon="EXPORT",
    )
    _draw_wrapped_text(
        composer,
        "Request only; scene unchanged.",
        icon="INFO",
    )
    if companion.revision_parameter_edit_count:
        composer.label(
            text=f"Structured edits: {companion.revision_parameter_edit_count}",
            icon="PREFERENCES",
        )
    if companion.dialogue_handoff.blocks_plan_work:
        _draw_wrapped_text(
            composer,
            "The authorized dialogue turn owns this draft until it finishes review delivery.",
            icon="TIME",
        )
    elif companion.provider_handoff.active:
        _draw_wrapped_text(
            composer,
            "Wait for the active provider run before sending another request.",
            icon="TIME",
        )
    elif companion.goal_request.active:
        _draw_wrapped_text(
            composer,
            "Wait for the active goal request and proposal review before sending a revision.",
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
    refresh.enabled = (
        companion.connected
        and not handoff.active
        and not companion.dialogue_handoff.blocks_plan_work
        and not companion.initial_plan_handoff.active
    )
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
        row.enabled = (
            available
            and not handoff.active
            and not companion.dialogue_handoff.blocks_plan_work
            and not companion.initial_plan_handoff.active
        )
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
                "A confirmed run sends the revision message, structured parameter edits, "
                "full base Plan, node references, ActionCatalog, and latest companion state.",
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
    run.enabled = (
        handoff.can_run
        and not companion.dialogue_handoff.blocks_plan_work
        and not companion.initial_plan_handoff.active
    )
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


def _draw_dialogue_handoff(layout, context, companion) -> None:
    """Draw explicit streamed dialogue with a fixed semantic replan gate."""
    handoff = companion.dialogue_handoff
    dialogue_box = layout.box()
    header = dialogue_box.row(align=True)
    header.label(text="Streamed model dialogue", icon="COMMUNITY")
    refresh = header.row(align=True)
    refresh.enabled = (
        companion.connected
        and not handoff.blocks_plan_work
        and not companion.provider_handoff.active
        and not companion.initial_plan_handoff.active
        and not companion.goal_request.active
    )
    refresh.operator(
        "operating_line.refresh_dialogue_providers",
        text="",
        icon="FILE_REFRESH",
    )
    _draw_wrapped_text(
        dialogue_box,
        "Select a provider and confirm each turn. One confirmation permits at most two calls.",
        icon="INFO",
    )
    _draw_wrapped_text(
        dialogue_box,
        "The first call streams a reply. A second replan call starts automatically only at 80%+ confidence.",
    )

    if not companion.connected:
        dialogue_box.label(text="Connect the runtime to list providers", icon="UNLINKED")
    elif handoff.loading_providers:
        dialogue_box.label(text="Refreshing dialogue providers...", icon="TIME")
    elif not handoff.providers:
        dialogue_box.label(text="No streamed dialogue provider configured", icon="INFO")

    for provider in handoff.providers:
        availability = provider["availability"]
        available = availability["available"]
        selected = provider["id"] == handoff.selected_provider_id
        item = dialogue_box.box()
        row = item.row(align=True)
        row.enabled = (
            available
            and not handoff.blocks_plan_work
            and not companion.provider_handoff.active
            and not companion.initial_plan_handoff.active
            and not companion.goal_request.active
        )
        select = row.operator(
            "operating_line.select_dialogue_provider",
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
        disclosure = dialogue_box.box()
        disclosure.label(text=f"Selected: {selected['displayName']}", icon="CHECKMARK")
        if selected["dataHandling"]["executionLocation"] == "remote":
            _draw_wrapped_text(
                disclosure,
                "A confirmed turn sends the message, recent dialogue, candidate revision, full base Plan, references, ActionCatalog, and latest state.",
                icon="URL",
            )
        else:
            _draw_wrapped_text(
                disclosure,
                "The provider runs locally with no provider data transmission.",
                icon="HOME",
            )
        _draw_wrapped_text(
            disclosure,
            "The provider may charge. OperatingLine cannot estimate fees or store its credentials.",
            icon="ERROR",
        )
        _draw_wrapped_text(
            disclosure,
            "A qualifying replan stops at a read-only Proposal; Accept remains manual.",
        )

    references = companion.revision_reference_nodes()
    user_message = context.window_manager.operating_line_revision_message.strip()
    run = dialogue_box.row()
    run.enabled = bool(
        companion.connected
        and handoff.can_run
        and references
        and user_message
        and companion.revision_operation_kind == "revise"
        and not companion.goal_request.active
        and not companion.provider_handoff.active
        and not companion.initial_plan_handoff.active
        and companion.proposed_plan is None
    )
    run.operator(
        "operating_line.run_dialogue_provider",
        text="Confirm Streamed Turn",
        icon="PLAY",
    )
    if not references or not user_message:
        _draw_wrapped_text(
            dialogue_box,
            "Use the revision composer above to reference nodes and enter this turn's message.",
            icon="GREASEPENCIL",
        )
    elif companion.revision_operation_kind != "revise":
        dialogue_box.label(text="Dialogue supports ordinary revise mode only", icon="ERROR")

    if handoff.history:
        history_box = dialogue_box.box()
        history_box.label(text="Recent dialogue", icon="TEXT")
        for message in handoff.history[-4:]:
            speaker = "You" if message["role"] == "user" else "Assistant"
            _draw_wrapped_text(history_box, f"{speaker}: {message['message']}")
    if handoff.active and handoff.assistant_message:
        stream_box = dialogue_box.box()
        stream_box.label(text="Assistant (streaming)", icon="TIME")
        _draw_wrapped_text(stream_box, handoff.assistant_message)
    if handoff.semantic_decision is not None:
        decision = handoff.semantic_decision
        if decision["kind"] == "replan":
            dialogue_box.label(
                text=f"Semantic replan {decision['confidence']:.0%} >= 80%",
                icon="FILE_REFRESH",
            )
        else:
            confidence = decision["replanConfidence"]
            label = (
                "Answer only"
                if confidence is None
                else f"Answer only; replan confidence {confidence:.0%}"
            )
            dialogue_box.label(text=label, icon="CHECKMARK")
    if handoff.message:
        status_icon = (
            "ERROR"
            if handoff.phase in {"needs_revision", "failed", "interrupted"}
            else "TIME" if handoff.active else "INFO"
        )
        _draw_wrapped_text(dialogue_box, handoff.message, icon=status_icon)
    if handoff.needs_revision_summary:
        _draw_wrapped_text(
            dialogue_box,
            f"Validation: {handoff.needs_revision_summary}",
            icon="ERROR",
        )
        for finding in handoff.needs_revision_findings:
            _draw_wrapped_text(dialogue_box, f"- {finding}")
    if handoff.dialogue_request_id is not None:
        dialogue_box.label(
            text=f"Turn {handoff.dialogue_request_id[:8]}  {handoff.phase}",
            icon="TIME" if handoff.active else "INFO",
        )


def _compact_history_message(value, limit: int = 76) -> str:
    rendered = " ".join(str(value).split())
    return rendered if len(rendered) <= limit else f"{rendered[: limit - 3]}..."


def _draw_revision_branches(layout, companion, active_session) -> None:
    branches_box = layout.box()
    header = branches_box.row(align=True)
    header.label(text="Revision branches", icon="LINKED")
    lineage = companion.active_revision_lineage
    can_prepare = not (
        companion.proposed_plan is not None
        or companion.goal_request.active
        or companion.provider_handoff.active
        or companion.initial_plan_handoff.active
        or companion.dialogue_handoff.blocks_plan_work
    )
    fork = header.row(align=True)
    fork.enabled = lineage is not None and can_prepare
    fork.operator(
        "operating_line.fork_revision_branch",
        text="Fork",
        icon="ADD",
    )

    if lineage is None:
        branches_box.label(
            text="Accept a revision to establish an active branch",
            icon="INFO",
        )
    else:
        branches_box.label(
            text=f"Active {lineage.thread_id[:8]}  turn {lineage.turn}",
            icon="FILE_TICK",
        )

    status_presentation = {
        "awaiting_proposal": ("Awaiting proposal", "TIME"),
        "awaiting_decision": ("Awaiting decision", "QUESTION"),
        "accepted": ("Accepted", "CHECKMARK"),
        "rejected": ("Rejected", "CANCEL"),
    }
    if not companion.revision_branches:
        branches_box.label(text="No revision branches stored for this Plan", icon="INFO")
    for branch in companion.revision_branches:
        item = branches_box.box()
        active = lineage is not None and branch["threadId"] == lineage.thread_id
        status_label, status_icon = status_presentation[branch["status"]]
        item.label(
            text=(
                f"{branch['threadId'][:8]}  turn {branch['headTurn']}  "
                f"{status_label}{'  Active' if active else ''}"
            ),
            icon="FILE_TICK" if active else status_icon,
        )
        operation = branch["operation"]
        if operation["kind"] != "revise":
            item.label(
                text=f"Head operation: {operation['kind']}",
                icon="FILE_REFRESH" if operation["kind"] == "merge" else "ADD",
            )
        plan = branch["plan"]
        if plan is not None:
            item.label(text=f"Plan r{plan['revision']}")
        if branch["status"] == "accepted" and not active:
            actions = item.row(align=True)
            actions.enabled = can_prepare and not bool(active_session.receipts)
            switch = actions.operator(
                "operating_line.switch_revision_branch",
                text="Switch",
                icon="FILE_TICK",
            )
            switch.thread_id = branch["threadId"]
            merge = actions.row(align=True)
            merge.enabled = lineage is not None
            merge_operator = merge.operator(
                "operating_line.merge_revision_branch",
                text="Merge",
                icon="FILE_REFRESH",
            )
            merge_operator.source_thread_id = branch["threadId"]

    if active_session.receipts:
        branches_box.label(
            text="Use Back to reach the start before switching or merging",
            icon="ERROR",
        )
    if companion.revision_branches_error:
        _draw_wrapped_text(
            branches_box,
            companion.revision_branches_error,
            icon="ERROR",
        )


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
        operation = record["request"].get("revisionOperation")
        if operation is not None and operation["kind"] != "revise":
            turn_box.label(
                text=(
                    f"{operation['kind'].capitalize()} from "
                    f"{operation['sourceThreadId'][:8]}"
                ),
                icon="FILE_REFRESH" if operation["kind"] == "merge" else "ADD",
            )
        references = " ".join(
            f"@{item['nodeNumber']}" for item in record["request"]["references"]
        )
        turn_box.label(text=f"You {references}", icon="GREASEPENCIL")
        for line in _wrap_history_message(record["request"]["message"]):
            turn_box.label(text=line)
        parameter_edits = record["request"].get("parameterEdits", [])
        if parameter_edits:
            turn_box.label(
                text=f"Structured edits {len(parameter_edits)}",
                icon="PREFERENCES",
            )
            for edit in parameter_edits[:3]:
                _draw_wrapped_text(
                    turn_box,
                    (
                        f"{edit['nodeId']}.{edit['argumentName']}: "
                        f"{_parameter_value(edit['before'])} -> "
                        f"{_parameter_value(edit['after'])}"
                    ),
                )
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
    _draw_revision_branches(workspace, companion, active_session)
    _draw_revision_request(workspace, context, companion)
    _draw_dialogue_handoff(workspace, context, companion)
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
