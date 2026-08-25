"""OperatingLine Blender extension entry point."""

import bpy
import uuid

from .application import DemoSession
from .application.companion import (
    MAX_COMPANION_REPORT_SEQUENCE,
    CompanionController,
)
from .domain import (
    SNOWMAN_PLAN_ID,
    SNOWMAN_PLAN_REVISION,
    SNOWMAN_TASK_TREE,
    bundled_plan_data,
)
from .infrastructure import (
    NativeHistoryRestore,
    action_registry,
    disable_overlay,
    discard_native_history,
    enable_overlay,
    forget_managed_collection,
    register_native_history,
    register_shortcut_history,
    unregister_native_history,
    unregister_shortcut_history,
)
from .infrastructure.observations import evaluate_observations
from .presentation import (
    CLASSES,
    register_outliner_header_entry,
    unregister_outliner_header_entry,
)
from .presentation.native_menu_guidance import (
    disable_native_menu_guidance,
    enable_native_menu_guidance,
    reset_native_menu_guidance,
)
from .presentation.native_menu_guidance import interaction_guidance_snapshot

_session: DemoSession | None = None
_companion: CompanionController | None = None
_COMPANION_INSTANCE_ID_SLOT = "operating_line_companion_instance_id"
_COMPANION_SESSION_ID_SLOT = "operating_line_companion_session_id"
_COMPANION_DOCUMENT_INCARNATION_ID_SLOT = (
    "operating_line_companion_document_incarnation_id"
)
_COMPANION_REPORT_SEQUENCE_SLOT = "operating_line_companion_report_sequence"
_process_session_id = str(uuid.uuid4())


def _runtime_namespace() -> dict:
    namespace = getattr(bpy.app, "driver_namespace", None)
    if not isinstance(namespace, dict):
        raise RuntimeError("Blender process runtime namespace is unavailable")
    return namespace


def _companion_runtime_id(slot: str, *, rotate: bool = False) -> str:
    namespace = _runtime_namespace()
    candidate = None if rotate else namespace.get(slot)
    try:
        parsed = uuid.UUID(str(candidate))
        if str(parsed) != candidate:
            raise ValueError
    except (AttributeError, TypeError, ValueError):
        candidate = str(uuid.uuid4())
        namespace[slot] = candidate
    return candidate


def _companion_instance_id(*, rotate: bool = False) -> str:
    return _companion_runtime_id(_COMPANION_INSTANCE_ID_SLOT, rotate=rotate)


def _companion_session_id(*, rotate: bool = False) -> str:
    global _process_session_id
    if rotate:
        _process_session_id = str(uuid.uuid4())
    try:
        parsed = uuid.UUID(_process_session_id)
        if str(parsed) != _process_session_id:
            raise ValueError
    except (AttributeError, TypeError, ValueError):
        _process_session_id = str(uuid.uuid4())
    namespace = _runtime_namespace()
    namespace[_COMPANION_SESSION_ID_SLOT] = _process_session_id
    return _process_session_id


def _companion_document_incarnation_id(*, rotate: bool = False) -> str:
    return _companion_runtime_id(
        _COMPANION_DOCUMENT_INCARNATION_ID_SLOT,
        rotate=rotate,
    )


def _companion_report_sequence(
    instance_id: str, *, observed_sequence: int | None = None
) -> int:
    """Keep report numbers monotonic across same-document controller reloads."""

    if (
        observed_sequence is not None
        and (
            isinstance(observed_sequence, bool)
            or not isinstance(observed_sequence, int)
            or observed_sequence < 0
            or observed_sequence > MAX_COMPANION_REPORT_SEQUENCE
        )
    ):
        raise ValueError("Companion report sequence must be a non-negative safe integer")
    namespace = _runtime_namespace()
    stored = namespace.get(_COMPANION_REPORT_SEQUENCE_SLOT)
    sequence = 0
    if stored is not None:
        if (
            not isinstance(stored, dict)
            or set(stored) != {"instanceId", "sequence"}
            or not isinstance(stored.get("instanceId"), str)
        ):
            raise RuntimeError("Blender process Companion report sequence is invalid")
        if stored["instanceId"] == instance_id:
            stored_sequence = stored.get("sequence")
            if (
                isinstance(stored_sequence, bool)
                or not isinstance(stored_sequence, int)
                or stored_sequence < 0
                or stored_sequence > MAX_COMPANION_REPORT_SEQUENCE
            ):
                raise RuntimeError(
                    "Blender process Companion report sequence is outside protocol bounds"
                )
            sequence = stored_sequence
    if observed_sequence is not None:
        sequence = max(sequence, observed_sequence)
    namespace[_COMPANION_REPORT_SEQUENCE_SLOT] = {
        "instanceId": instance_id,
        "sequence": sequence,
    }
    return sequence


def get_session() -> DemoSession:
    global _session
    if _session is None:
        _session = DemoSession(
            SNOWMAN_TASK_TREE,
            action_registry(SNOWMAN_TASK_TREE),
            plan_id=SNOWMAN_PLAN_ID,
            revision=SNOWMAN_PLAN_REVISION,
            source_plan=bundled_plan_data(),
            observation_evaluator=evaluate_observations,
        )
    return _session


def replace_session(replacement: DemoSession) -> None:
    """Install a validated session without mutating the Blender scene."""
    global _session
    if _session is not None and _session.has_execution_state:
        raise ValueError(
            "A plan update is pending; finish/abort leaf operations and use Back first"
        )
    discard_native_history()
    _session = replacement
    reset_native_menu_guidance()


def get_companion() -> CompanionController:
    global _companion
    if _companion is None:
        instance_id = _companion_instance_id()
        _companion = CompanionController(
            instance_id,
            session_id=_companion_session_id(),
            document_incarnation_id=_companion_document_incarnation_id(),
            initial_report_sequence=_companion_report_sequence(instance_id),
        )
    return _companion


def _native_history_restored(restore: NativeHistoryRestore) -> None:
    """Refresh guide reporting after Blender has restored a checkpoint."""
    session = get_session()
    reset_native_menu_guidance()
    companion = get_companion()
    before = restore.before
    after = restore.after

    if after.started and not before.started:
        enable_native_menu_guidance(get_session)
        enable_overlay(get_session, interaction_guidance_snapshot)
        for window_manager in bpy.data.window_managers:
            if hasattr(window_manager, "operating_line_overlay_enabled"):
                window_manager.operating_line_overlay_enabled = True
    elif not after.started and before.started:
        disable_native_menu_guidance()
        disable_overlay()
        for window_manager in bpy.data.window_managers:
            if hasattr(window_manager, "operating_line_overlay_enabled"):
                window_manager.operating_line_overlay_enabled = False

    try:
        if after == before:
            # A quarantined host-only mutation changes Blender's undo boundary but
            # intentionally leaves the managed Session snapshot untouched.
            return
        if after.execution_id != before.execution_id:
            companion.report("walkthrough_started" if after.started else "plan_loaded")
            return
        if (
            after.active_index == before.active_index
            and after.leaf_operation_runs != before.leaf_operation_runs
            and after.observation_gate == before.observation_gate
        ):
            # Intermediate leaf-local checkpoints are Blender/UI state only;
            # the companion protocol remains leaf-atomic until promotion.
            return
        gate = after.observation_gate
        if gate is not None and gate.status != "recovered":
            step = session.find_node(gate.step_id)
            companion.report(
                "step_observation_failed",
                step=step,
                observations_override=gate.observation_copy(),
                observation_gate_override=gate,
            )
            return
        if gate is not None and gate.status == "recovered":
            step = session.find_node(gate.step_id)
            companion.report(
                "observation_recovered",
                step=step,
                observations_override=gate.observation_copy(),
                observation_gate_override=gate,
            )
            return
        if after.active_index < before.active_index:
            step = session.steps[before.active_index]
            companion.report("step_rolled_back", step=step)
            return
        if after.active_index > before.active_index:
            step = session.steps[after.active_index]
            companion.report("step_succeeded", step=step)
            return
        companion.report("walkthrough_started" if after.started else "plan_loaded")
    except (IndexError, OSError, RuntimeError, ValueError) as error:
        companion.error = f"Native Undo reporting failed: {error}"


def _native_history_file_loaded() -> None:
    global _companion
    session_id = _companion_session_id()
    rotated_instance_id = _companion_instance_id(rotate=True)
    rotated_document_incarnation_id = _companion_document_incarnation_id(
        rotate=True
    )
    disable_native_menu_guidance()
    disable_overlay()
    reset_native_menu_guidance()
    if _companion is not None:
        previous = _companion
        previous.unregister_timer(document_replaced=True)
        _companion = CompanionController(
            rotated_instance_id,
            session_id=session_id,
            document_incarnation_id=rotated_document_incarnation_id,
        )
        _companion.register_timer()


def register() -> None:
    global _session
    for cls in CLASSES:
        if not getattr(cls, "is_registered", False):
            bpy.utils.register_class(cls)
    register_outliner_header_entry()
    if not hasattr(bpy.types.Scene, "operating_line_replace_factory_scene"):
        bpy.types.Scene.operating_line_replace_factory_scene = bpy.props.BoolProperty(
            name="Delete factory Cube/Camera/Light on Start",
            description=(
                "Explicitly allow Start to delete the recognized factory startup trio; "
                "disabled by default to protect user data"
            ),
            default=False,
        )
    if not hasattr(bpy.types.WindowManager, "operating_line_overlay_enabled"):
        bpy.types.WindowManager.operating_line_overlay_enabled = bpy.props.BoolProperty(
            name="Guidance visible",
            description="Show the OperatingLine viewport guidance and task details",
            default=False,
            options={"SKIP_SAVE"},
        )
    if not hasattr(bpy.types.WindowManager, "operating_line_runtime_url"):
        bpy.types.WindowManager.operating_line_runtime_url = bpy.props.StringProperty(
            name="Runtime URL",
            description="Loopback URL of the OperatingLine runtime",
            default="http://127.0.0.1:43123",
            options={"SKIP_SAVE"},
        )
    if not hasattr(bpy.types.WindowManager, "operating_line_bearer_token"):
        bpy.types.WindowManager.operating_line_bearer_token = bpy.props.StringProperty(
            name="Bearer token",
            description="Runtime access token (kept only for this Blender process)",
            subtype="PASSWORD",
            options={"SKIP_SAVE"},
        )
    if not hasattr(bpy.types.WindowManager, "operating_line_revision_message"):
        bpy.types.WindowManager.operating_line_revision_message = bpy.props.StringProperty(
            name="Requested change",
            description=(
                "Describe a change to the referenced task nodes; sending creates "
                "an immutable request and does not change the scene"
            ),
            default="",
            maxlen=4000,
            options={"SKIP_SAVE"},
        )
    if not hasattr(bpy.types.WindowManager, "operating_line_goal"):
        bpy.types.WindowManager.operating_line_goal = bpy.props.StringProperty(
            name="Goal",
            description="Describe the result for a new review-gated guidance plan",
            default="",
            maxlen=10000,
            options={"SKIP_SAVE"},
        )
    if not hasattr(
        bpy.types.WindowManager,
        "operating_line_goal_workspace_expanded",
    ):
        bpy.types.WindowManager.operating_line_goal_workspace_expanded = (
            bpy.props.BoolProperty(
                name="Goal to Guidance expanded",
                description="Show initial goal entry or its current delivery status",
                default=True,
                options={"SKIP_SAVE"},
            )
        )
    if not hasattr(
        bpy.types.WindowManager,
        "operating_line_revision_history_expanded",
    ):
        bpy.types.WindowManager.operating_line_revision_history_expanded = (
            bpy.props.BoolProperty(
                name="Show all loaded revision turns",
                description="Expand every revision turn already loaded from the runtime",
                default=False,
                options={"SKIP_SAVE"},
            )
        )
    if not hasattr(
        bpy.types.WindowManager,
        "operating_line_revision_workspace_expanded",
    ):
        bpy.types.WindowManager.operating_line_revision_workspace_expanded = (
            bpy.props.BoolProperty(
                name="Revision Workspace expanded",
                description=(
                    "Show revision references, immutable thread history, and plan review"
                ),
                default=True,
                options={"SKIP_SAVE"},
            )
        )
    if _session is None:
        _session = DemoSession(
            SNOWMAN_TASK_TREE,
            action_registry(SNOWMAN_TASK_TREE),
            plan_id=SNOWMAN_PLAN_ID,
            revision=SNOWMAN_PLAN_REVISION,
            source_plan=bundled_plan_data(),
            observation_evaluator=evaluate_observations,
        )
    register_native_history(
        get_session,
        _native_history_restored,
        _native_history_file_loaded,
    )
    register_shortcut_history()
    get_companion().register_timer()


def unregister() -> None:
    global _companion, _session
    # Remove the callback before any other teardown. If Blender refuses this
    # step, the extension remains fully registered instead of leaving an
    # Outliner callback that depends on already-removed state.
    unregister_outliner_header_entry()
    if _companion is not None:
        _companion.unregister_timer()
        _companion_report_sequence(
            _companion.instance_id,
            observed_sequence=_companion.report_sequence,
        )
    unregister_shortcut_history()
    unregister_native_history()
    disable_native_menu_guidance()
    disable_overlay()
    reset_completed = True
    if _session is not None:
        try:
            _session.reset()
        except (OSError, RuntimeError, ValueError) as error:
            reset_completed = False
            print(
                "OperatingLine kept conflicted resources and their rollback "
                f"receipts during unregister: {error}"
            )
    forget_managed_collection()
    for property_name in ("operating_line_replace_factory_scene",):
        if hasattr(bpy.types.Scene, property_name):
            delattr(bpy.types.Scene, property_name)
    for property_name in (
        "operating_line_overlay_enabled",
        "operating_line_runtime_url",
        "operating_line_bearer_token",
        "operating_line_revision_message",
        "operating_line_goal",
        "operating_line_goal_workspace_expanded",
        "operating_line_revision_history_expanded",
        "operating_line_revision_workspace_expanded",
    ):
        if hasattr(bpy.types.WindowManager, property_name):
            delattr(bpy.types.WindowManager, property_name)
    for cls in reversed(CLASSES):
        if getattr(cls, "is_registered", False):
            bpy.utils.unregister_class(cls)
    if reset_completed:
        _session = None
    _companion = None
    # A completed controller lifetime teardown is a new Companion process-
    # session boundary even when Python keeps this module loaded.
    # Keep the Blender document/instance identities stable so Runtime can
    # issue a same-document recovery challenge instead of leaving a delivered
    # operation permanently locked.
    _companion_session_id(rotate=True)
