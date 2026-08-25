"""Application command for one exact guided leaf operation.

The command owns session mutation, executor compensation, and native-history
atomicity.  Blender's history implementation still needs a Scene/UI boundary,
so it is supplied through :class:`GuidedGeometryHistoryPort`; the command itself
never imports ``bpy`` or invokes ``bpy.ops``.
"""

from copy import deepcopy
from dataclasses import dataclass, replace
from typing import Any, Callable

from .session import ObservationGateError


@dataclass(frozen=True, slots=True)
class GuidedGeometryReportTransition:
    """Companion transition the presentation adapter must publish."""

    name: str
    step: Any
    error: str | None = None
    observations_override: list[dict[str, Any]] | None = None
    observation_gate_override: Any | None = None


@dataclass(frozen=True, slots=True)
class GuidedGeometryCommandResult:
    """Strict outcome of one accepted, history-bounded operation command."""

    run_id: str
    binding_sha256: str
    operation_id: str
    ordinal: int
    total: int
    next_ordinal: int
    completed_operation_ids: tuple[str, ...]
    observation: dict[str, Any]
    leaf_completed: bool
    report_transition: GuidedGeometryReportTransition | None
    operator_status: str = "FINISHED"
    report_level: str = "INFO"
    report_message: str | None = None
    native_undo_required: bool = False
    focus_next: bool = False


@dataclass(frozen=True, slots=True)
class GuidedGeometryCommandFailure:
    """Handled failure after a native-history boundary has been prepared."""

    operator_status: str
    report_level: str
    report_message: str
    report_transition: GuidedGeometryReportTransition
    native_undo_required: bool = False


class GuidedGeometryCommandRejected(ValueError):
    """A stale or invalid command rejected before native history is opened."""


@dataclass(frozen=True, slots=True)
class GuidedGeometryHistoryPort:
    """Injected host boundary for atomic native history.

    ``prepare`` is the sole callback that may close over Blender UI context
    (normally ``context.scene``).  All remaining callbacks are context-free.
    """

    prepare: Callable[[str], None]
    commit: Callable[..., None]
    cancel: Callable[[], None]
    changed: Callable[[Any], bool]
    make_recovery: Callable[[Any, Callable[[], bool]], Any]
    requires_native_undo: Callable[[], bool]
    is_native_undo_required_error: Callable[[BaseException], bool]


@dataclass(frozen=True, slots=True)
class GuidedGeometryCommandServices:
    validate_definition: Callable[[Any], Any]
    execute_operation: Callable[..., Any]
    inverse_operation: Callable[..., Any]
    resume_transaction: Callable[..., Any]
    verify_stage: Callable[..., bool]
    history: GuidedGeometryHistoryPort
    is_guided_atomicity_error: Callable[[BaseException], bool]
    is_action_atomicity_error: Callable[[BaseException], bool]
    is_host_state_restored_error: Callable[[BaseException], bool]
    observation_gate_error: type[BaseException] = ObservationGateError


def _probe_matches(probe) -> bool:
    if probe is None:
        return False
    try:
        return probe() is True
    except Exception:
        return False


def _bound_observation(result, run) -> dict[str, Any]:
    observation = deepcopy(result.observation)
    if not isinstance(observation, dict) or not isinstance(
        observation.get("details"), dict
    ):
        raise RuntimeError("Guided leaf executor returned invalid observation evidence")
    observation["details"].update(
        {
            "runId": run.run_id,
            "recipeId": run.recipe_id,
            "catalogVersion": run.catalog_version,
        }
    )
    return observation


def _receipt_has_state(receipt: Any) -> bool:
    if receipt is None:
        return False
    if not any(hasattr(receipt, field) for field in ("created", "mutations", "deleted")):
        return True
    return bool(
        getattr(receipt, "created", ())
        or getattr(receipt, "mutations", ())
        or getattr(receipt, "deleted", ())
    )


def _transaction(services, session, step, run, definition):
    completed = tuple(receipt.ordinal for receipt in run.operation_receipts)
    if not completed:
        return None
    if run.partial_action_receipt is None:
        transaction = None
        for expected in run.operation_receipts:
            replay = services.execute_operation(
                operation_ordinal=expected.ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=transaction,
            )
            if (
                replay.before_fingerprint != expected.before_sha256
                or replay.after_fingerprint != expected.after_sha256
                or _receipt_has_state(replay.receipt)
            ):
                raise RuntimeError("Guided leaf pre-mutation fingerprint changed")
            transaction = replay.transaction
        return transaction
    return services.resume_transaction(
        receipt=run.partial_action_receipt,
        completed_operations=completed,
        fingerprint=run.operation_receipts[-1].after_sha256,
        definition=definition,
    )


def _recovery_probe(
    services,
    session,
    step,
    run,
    definition,
    *,
    empty_stage_fingerprint=None,
    empty_stage_receipt_id=None,
):
    receipts = dict(session.receipts)
    if run is not None and run.operation_receipts:
        completed = tuple(receipt.ordinal for receipt in run.operation_receipts)
        expected_fingerprint = run.operation_receipts[-1].after_sha256
        partial_receipt = run.partial_action_receipt
        receipt_id = run.leaf_receipt_id
    elif empty_stage_fingerprint is not None and empty_stage_receipt_id:
        completed = ()
        expected_fingerprint = empty_stage_fingerprint
        partial_receipt = None
        receipt_id = empty_stage_receipt_id
    else:
        return None

    def prove_prepared_stage():
        return services.verify_stage(
            receipt_id=receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=receipts,
            definition=definition,
            completed_operations=completed,
            expected_fingerprint=expected_fingerprint,
            partial_receipt=partial_receipt,
            rebind_after_native_restore=True,
        )

    return prove_prepared_stage


def _replay_prefix(services, session, step, run, definition, recovery_probe):
    if recovery_probe is not None and _probe_matches(recovery_probe):
        return run, recovery_probe
    transaction = None
    replayed_partial = None
    replayed_receipts = []
    for receipt in run.operation_receipts:
        result = services.execute_operation(
            operation_ordinal=receipt.ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = result.transaction
        replayed_partial = result.receipt
        replayed_receipts.append(
            replace(
                receipt,
                before_sha256=result.before_fingerprint,
                after_sha256=result.after_fingerprint,
                observation=_bound_observation(result, run),
            )
        )
    replayed_run = replace(
        run,
        operation_receipts=tuple(replayed_receipts),
        partial_action_receipt=(
            replayed_partial
            if replayed_partial is not None and _receipt_has_state(replayed_partial)
            else None
        ),
    )
    replayed_probe = _recovery_probe(
        services, session, step, replayed_run, definition
    )
    if replayed_probe is None or not _probe_matches(replayed_probe):
        raise RuntimeError(
            "Guided leaf prefix replay did not restore the prepared Blender state"
        )
    return replayed_run, replayed_probe


def _validate_request(
    session,
    step,
    snapshot,
    *,
    step_id,
    operation_id,
    ordinal,
    cursor_token,
    run_id,
    action_name,
    recipe_id,
):
    if (
        step is None
        or session.guidance_step is not step
        or step.id != step_id
        or snapshot is None
        or snapshot.cursor_token != cursor_token
        or getattr(step.action, "name", None) != action_name
        or snapshot.recipe_id != recipe_id
    ):
        raise GuidedGeometryCommandRejected(
            "The guided leaf changed; control ignored"
        )
    operation = next(
        (
            candidate
            for candidate in snapshot.operations
            if candidate.operation_id == operation_id and candidate.ordinal == ordinal
        ),
        None,
    )
    if operation is None:
        raise GuidedGeometryCommandRejected(
            "The guided leaf operation changed; control ignored"
        )
    if snapshot.focused_ordinal != ordinal:
        raise GuidedGeometryCommandRejected(
            "Focus this numbered instruction before execution"
        )
    if snapshot.focused_operation.operation_id != operation_id:
        raise GuidedGeometryCommandRejected(
            "The focused guided leaf operation changed"
        )
    existing = session.pending_leaf_operation_run
    if existing is None:
        if run_id or ordinal != 1:
            raise GuidedGeometryCommandRejected("Execute operation 01 to start this leaf")
    elif run_id != existing.run_id:
        raise GuidedGeometryCommandRejected(
            "The guided operation run changed; control ignored"
        )
    if existing is not None and existing.next_ordinal != ordinal:
        raise GuidedGeometryCommandRejected(
            f"Execute operation {existing.next_ordinal:02d} next"
        )
    return operation, existing


def _commit(services, session, *, rollback=None, quarantine=False, recovery_probe=None):
    options = {}
    if rollback is not None:
        options["rollback"] = rollback
    if quarantine:
        options["quarantine"] = True
    if recovery_probe is not None:
        options["recovery_probe"] = recovery_probe
    services.history.commit(session, **options)


def execute_guided_geometry_operation(
    *,
    session,
    step,
    snapshot,
    step_id: str,
    operation_id: str,
    ordinal: int,
    cursor_token: str,
    run_id: str,
    action_name: str,
    recipe_id: str,
    services: GuidedGeometryCommandServices,
) -> GuidedGeometryCommandResult | GuidedGeometryCommandFailure:
    """Execute one CAS-bound guided leaf microstep without UI context."""

    operation, existing = _validate_request(
        session,
        step,
        snapshot,
        step_id=step_id,
        operation_id=operation_id,
        ordinal=ordinal,
        cursor_token=cursor_token,
        run_id=run_id,
        action_name=action_name,
        recipe_id=recipe_id,
    )
    definition = services.validate_definition(step.action.arguments)
    operation_ids = tuple(candidate.operation_id for candidate in snapshot.operations)
    total = len(operation_ids)
    services.history.prepare("next" if ordinal == total else "leaf_operation")
    prepared_session_snapshot = session.snapshot_state()
    opened_run = existing is None
    prepared_run = existing
    commit_rollback = None
    recovery_probe = _recovery_probe(
        services, session, step, prepared_run, definition
    )
    result = None
    run = existing
    bound_observation = {}
    try:
        run = session.begin_leaf_operation_run(
            step,
            recipe_id=snapshot.recipe_id,
            catalog_version=snapshot.catalog_version,
            operation_ids=operation_ids,
        )
        transaction = _transaction(services, session, step, run, definition)
        result = services.execute_operation(
            operation_ordinal=ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        if recovery_probe is None:
            recovery_probe = _recovery_probe(
                services,
                session,
                step,
                None,
                definition,
                empty_stage_fingerprint=result.before_fingerprint,
                empty_stage_receipt_id=run.leaf_receipt_id,
            )
        rollback_applied = False

        def rollback_operation():
            nonlocal rollback_applied
            if rollback_applied:
                return
            services.inverse_operation(
                operation_ordinal=ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=result.transaction,
            )
            rollback_applied = True

        commit_rollback = rollback_operation
        partial_receipt = (
            result.receipt if _receipt_has_state(result.receipt) else None
        )
        bound_observation = _bound_observation(result, run)
        try:
            run = session.record_leaf_operation(
                step,
                run_id=run.run_id,
                operation_id=operation.operation_id,
                ordinal=operation.ordinal,
                before_sha256=result.before_fingerprint,
                after_sha256=result.after_fingerprint,
                observation=bound_observation,
                partial_action_receipt=partial_receipt,
            )
        except Exception:
            services.inverse_operation(
                operation_ordinal=ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=result.transaction,
            )
            raise
        if ordinal == total:
            try:
                session.complete_leaf_operation_run(step, run_id=run.run_id)
            except services.observation_gate_error:
                raise
            except Exception:
                inverse = services.inverse_operation(
                    operation_ordinal=ordinal,
                    receipt_id=run.leaf_receipt_id,
                    step_id=step.id,
                    action_name=step.action.name,
                    receipts=session.receipts,
                    definition=definition,
                    transaction=result.transaction,
                )
                session.rewind_leaf_operation(
                    step,
                    run_id=run.run_id,
                    operation_id=operation.operation_id,
                    ordinal=operation.ordinal,
                    partial_action_receipt=(
                        inverse.receipt
                        if _receipt_has_state(inverse.receipt)
                        else None
                    ),
                )
                raise
    except services.observation_gate_error as error:
        rollback_failed = error.gate.status == "rollback_failed"
        native_undo_required = False
        if rollback_failed:
            try:
                _commit(
                    services,
                    session,
                    quarantine=True,
                    recovery_probe=recovery_probe,
                )
                status = "FINISHED"
            except (OSError, RuntimeError, ValueError) as commit_error:
                native_undo_required = (
                    services.history.is_native_undo_required_error(commit_error)
                    or services.history.requires_native_undo()
                )
                status = "FINISHED" if native_undo_required else "CANCELLED"
        elif services.history.changed(session):
            if prepared_run is None:
                raise RuntimeError(
                    "The final guided operation has no prepared operation prefix"
                ) from error

            def restore_prepared_after_gate():
                replayed_run, replayed_probe = _replay_prefix(
                    services,
                    session,
                    step,
                    prepared_run,
                    definition,
                    recovery_probe,
                )
                rebased_snapshot = session.rebase_leaf_operation_replay(
                    prepared_session_snapshot,
                    step_id=step.id,
                    original_run=prepared_run,
                    replayed_run=replayed_run,
                )
                return services.history.make_recovery(rebased_snapshot, replayed_probe)

            try:
                _commit(
                    services,
                    session,
                    rollback=restore_prepared_after_gate,
                    recovery_probe=recovery_probe,
                )
                status = "FINISHED"
            except (OSError, RuntimeError, ValueError) as commit_error:
                native_undo_required = (
                    services.history.is_native_undo_required_error(commit_error)
                    or services.history.requires_native_undo()
                )
                status = "FINISHED" if native_undo_required else "CANCELLED"
        else:
            services.history.cancel()
            status = "CANCELLED"
        completed_ids = tuple(
            receipt.operation_id for receipt in getattr(run, "operation_receipts", ())
        )
        return GuidedGeometryCommandResult(
            run_id=run.run_id,
            binding_sha256=run.binding_sha256,
            operation_id=operation.operation_id,
            ordinal=operation.ordinal,
            total=total,
            next_ordinal=run.next_ordinal,
            completed_operation_ids=completed_ids,
            observation=deepcopy(bound_observation),
            leaf_completed=False,
            report_transition=GuidedGeometryReportTransition(
                "step_observation_failed",
                error.step,
                observations_override=error.gate.observation_copy(),
                observation_gate_override=error.gate,
            ),
            operator_status=status,
            report_level="WARNING",
            report_message=str(error),
            native_undo_required=rollback_failed or native_undo_required,
        )
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        if opened_run:
            try:
                pending = session.pending_leaf_operation_run
                if pending is not None and not pending.operation_receipts:
                    session.discard_empty_leaf_operation_run(run_id=pending.run_id)
            except (RuntimeError, ValueError):
                pass
        changed = services.history.changed(session)
        host_recovery_proven = services.is_host_state_restored_error(
            error
        ) or _probe_matches(recovery_probe)
        quarantine = (
            services.is_guided_atomicity_error(error)
            or services.is_action_atomicity_error(error)
            or not host_recovery_proven
        )
        committed = False
        native_undo_required = False
        if changed or quarantine:
            try:
                _commit(
                    services,
                    session,
                    quarantine=quarantine,
                    recovery_probe=recovery_probe,
                )
                committed = True
            except (OSError, RuntimeError, ValueError) as commit_error:
                error = commit_error
                native_undo_required = (
                    services.history.is_native_undo_required_error(commit_error)
                    or services.history.requires_native_undo()
                )
        else:
            services.history.cancel()
        undo_required = quarantine or native_undo_required
        status = (
            "FINISHED"
            if quarantine or (changed and committed) or native_undo_required
            else "CANCELLED"
        )
        return GuidedGeometryCommandFailure(
            operator_status=status,
            report_level="WARNING" if undo_required else "ERROR",
            report_message=str(error),
            report_transition=GuidedGeometryReportTransition(
                "error", step, error=str(error)
            ),
            native_undo_required=undo_required,
        )

    try:
        _commit(
            services,
            session,
            rollback=commit_rollback,
            recovery_probe=recovery_probe,
        )
    except (OSError, RuntimeError, ValueError) as error:
        native_undo_required = (
            services.history.is_native_undo_required_error(error)
            or services.history.requires_native_undo()
        )
        return GuidedGeometryCommandFailure(
            operator_status="FINISHED" if native_undo_required else "CANCELLED",
            report_level="WARNING" if native_undo_required else "ERROR",
            report_message=str(error),
            report_transition=GuidedGeometryReportTransition(
                "error", session.active_step, error=str(error)
            ),
            native_undo_required=native_undo_required,
        )
    completed_ids = tuple(receipt.operation_id for receipt in run.operation_receipts)
    completed = ordinal == total
    return GuidedGeometryCommandResult(
        run_id=run.run_id,
        binding_sha256=run.binding_sha256,
        operation_id=operation.operation_id,
        ordinal=operation.ordinal,
        total=total,
        next_ordinal=run.next_ordinal,
        completed_operation_ids=completed_ids,
        observation=deepcopy(bound_observation),
        leaf_completed=completed,
        report_transition=(
            GuidedGeometryReportTransition("step_succeeded", step)
            if completed
            else None
        ),
        report_message=f"STATE VERIFIED · operation {ordinal:02d} {operation.label}",
        focus_next=not completed,
    )
