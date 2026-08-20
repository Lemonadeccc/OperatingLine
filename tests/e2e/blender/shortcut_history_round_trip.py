"""Foreground Blender proof for the shortcut mutation lock's Undo/Redo lifecycle."""

from __future__ import annotations

import importlib.util
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import traceback
import uuid

import bpy


sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
RESULT_PATH = Path(os.environ["OPERATINGLINE_SHORTCUT_HISTORY_RESULT"])
FIXTURE_IDENTITY = {
    "proof_id": "00000000-0000-4000-8000-000000000031",
    "request_id": "00000000-0000-4000-8000-000000000032",
    "delivery_id": "00000000-0000-4000-8000-000000000033",
    "binding_content_sha256": "c" * 64,
}
RECOVERY_REPLAY_ID = "00000000-0000-4000-8000-000000000034"
RECOVERY_ID = "00000000-0000-4000-8000-000000000035"
RECOVERY_INSTANCE_ID = "00000000-0000-4000-8000-000000000036"

spec = importlib.util.spec_from_file_location(
    "operating_line_shortcut_history_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
extension = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extension
spec.loader.exec_module(extension)
addon = importlib.import_module(f"{spec.name}.operating_line")

from operating_line_shortcut_history_e2e.operating_line.application.companion import (  # noqa: E402
    CompanionController,
)

from operating_line_shortcut_history_e2e.operating_line.infrastructure import (  # noqa: E402
    acknowledge_shortcut_transition_results,
    register_shortcut_history,
    shortcut_history_current_attestation,
    shortcut_history_error,
    shortcut_history_mutation_locked,
    unregister_shortcut_history,
)
from operating_line_shortcut_history_e2e.operating_line.infrastructure import (  # noqa: E402
    shortcut_history,
    shortcut_proof,
)


WINDOW = bpy.context.window
AREA = next(area for area in WINDOW.screen.areas if area.type == "VIEW_3D")
REGION = next(region for region in AREA.regions if region.type == "WINDOW")
SPACE = AREA.spaces.active
events: list[dict[str, object]] = []
proof_payload: dict[str, object] | None = None
initial_attestation: dict[str, object] | None = None
recovery_ack: dict[str, object] | None = None
recovery_ack_duplicate: dict[str, object] | None = None
driver_start_count = 0
driver_event_simulate_count = 0
driver_event_simulate_count_at_terminal = 0
delivery_failure_retained = False
terminal_result_accepted_before_ack_loss = False
terminal_outbox_matches_accepted_result = False


class AcceptedTerminalRuntime:
    """Strict in-process Runtime state across an HTTP response-loss restart."""

    def __init__(self, delivery: dict[str, object]) -> None:
        self.delivery = deepcopy(delivery)
        self.running = True
        self.last_delivered_sequence = 0
        self.progress: list[dict[str, object]] = []
        self.results: list[dict[str, object]] = []
        self.accepted_terminal_result: dict[str, object] | None = None
        self.accepted_terminal_result_sha256: str | None = None
        self.terminal_ack_loss_raised = False
        self.fail_recovery_ack = False
        self.acks: list[dict[str, object]] = []

    def submit_shortcut_proof_progress(self, progress: dict[str, object]) -> None:
        assert progress["requestId"] == self.delivery["requestId"]
        assert progress["deliveryId"] == self.delivery["deliveryId"]
        assert progress["status"] == "in_progress"
        self.progress.append(deepcopy(progress))

    def submit_shortcut_proof_result(self, result: dict[str, object]) -> None:
        assert result["requestId"] == self.delivery["requestId"]
        assert result["deliveryId"] == self.delivery["deliveryId"]
        assert result["bindingContentSha256"] == self.delivery[
            "bindingContentSha256"
        ]
        self.results.append(deepcopy(result))
        if result["status"] != "succeeded":
            return
        assert self.accepted_terminal_result is None
        assert result["terminalEvidence"]["kind"] == "succeeded_locked"
        checkpoint = result["terminalEvidence"]["attestation"][
            "nativeUndoCheckpoint"
        ]
        assert checkpoint["proofId"] == result["proofId"]
        assert checkpoint["replayId"] == result["replayId"]
        self.accepted_terminal_result = deepcopy(result)
        self.accepted_terminal_result_sha256 = shortcut_history._canonical_sha256(
            result
        )
        self.terminal_ack_loss_raised = True
        bpy.app.timers.register(begin_terminal_recovery, first_interval=0.05)
        raise RuntimeError("simulated terminal HTTP acknowledgement loss")

    def submit_shortcut_proof_recovery_ack(self, ack: dict[str, object]) -> None:
        if self.fail_recovery_ack:
            raise RuntimeError("simulated ACK delivery loss")
        self.acks.append(deepcopy(ack))

    def native_history_rebind(self, scene: object) -> dict[str, object]:
        result = self.accepted_terminal_result
        result_sha256 = self.accepted_terminal_result_sha256
        assert result is not None and result_sha256 is not None
        checkpoint = result["terminalEvidence"]["attestation"][
            "nativeUndoCheckpoint"
        ]
        marker = json.loads(scene[shortcut_history.SHORTCUT_HISTORY_MARKER_KEY])
        assert marker["terminalResult"] == result
        assert marker["terminalResultContentSha256"] == result_sha256
        marker_sha256 = shortcut_history._canonical_sha256(
            shortcut_history.ShortcutHistoryController._marker_identity(marker)
        )
        return {
            **deepcopy(self.delivery),
            "kind": "native_history_rebind",
            "recoveryId": RECOVERY_ID,
            "history": {
                "checkpointId": checkpoint["checkpointId"],
                "undoLockId": checkpoint["undoLockId"],
                "checkpointKind": "success",
                "baselineSceneFingerprintSha256": checkpoint[
                    "baselineSceneFingerprintSha256"
                ],
                "lockedSceneFingerprintSha256": checkpoint[
                    "finalSceneFingerprintSha256"
                ],
                "terminalResultContentSha256": result_sha256,
            },
            "expectedMarkerContentSha256": marker_sha256,
            "expectedResultContentSha256": result_sha256,
            "expectedStatus": "succeeded",
            "recoveryRequestedAt": "2026-08-20T00:00:00Z",
        }


def write_result(payload: dict[str, object]) -> None:
    RESULT_PATH.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


def fail(error: object) -> None:
    write_result(
        {
            "ok": False,
            "error": str(error),
            "historyError": shortcut_history_error(),
            "traceback": traceback.format_exc(),
        }
    )
    bpy.ops.wm.quit_blender()


def restored(transition) -> None:
    events.append(
        {
            "direction": transition.direction,
            "status": transition.status,
            "fingerprint": transition.scene_fingerprint_sha256,
        }
    )


def reapplied(transition) -> None:
    events.append(
        {
            "direction": transition.direction,
            "status": transition.status,
            "fingerprint": transition.scene_fingerprint_sha256,
        }
    )


def simulate(event_type: str, value: str, *, ctrl: bool, shift: bool) -> None:
    x = AREA.x + AREA.width // 2
    y = AREA.y + AREA.height // 2
    WINDOW.event_simulate(
        type=event_type,
        value=value,
        x=x,
        y=y,
        ctrl=ctrl,
        shift=shift,
    )


def send_undo() -> None:
    with bpy.context.temp_override(
        window=WINDOW,
        area=AREA,
        region=REGION,
        space_data=SPACE,
    ):
        simulate("Z", "PRESS", ctrl=True, shift=False)
        simulate("Z", "RELEASE", ctrl=True, shift=False)
    bpy.app.timers.register(verify_undo, first_interval=0.8)


def verify_undo() -> None:
    assert proof_payload is not None
    assert shortcut_history_mutation_locked() is False
    assert shortcut_history_error() == ""
    assert shortcut_history_current_attestation() is None
    assert events == [
        {
            "direction": "undo",
            "status": "restored",
            "fingerprint": proof_payload["baselineSceneFingerprintSha256"],
        }
    ]
    marker = json.loads(bpy.context.scene[shortcut_history.SHORTCUT_HISTORY_MARKER_KEY])
    assert [result["status"] for result in marker["transitionResults"]] == [
        "restored"
    ]
    acknowledge_shortcut_transition_results(
        marker["transitionResultContentSha256s"]
    )
    acknowledged_marker = json.loads(
        bpy.context.scene[shortcut_history.SHORTCUT_HISTORY_MARKER_KEY]
    )
    assert acknowledged_marker["transitionResults"] == []
    bpy.app.timers.register(send_redo, first_interval=0.05)


def send_redo() -> None:
    with bpy.context.temp_override(
        window=WINDOW,
        area=AREA,
        region=REGION,
        space_data=SPACE,
    ):
        simulate("Z", "PRESS", ctrl=True, shift=True)
        simulate("Z", "RELEASE", ctrl=True, shift=True)
    bpy.app.timers.register(verify_redo, first_interval=0.8)


def verify_redo() -> None:
    assert proof_payload is not None
    assert initial_attestation is not None
    assert shortcut_history_mutation_locked() is True
    assert shortcut_history_error() == ""
    assert events == [
        {
            "direction": "undo",
            "status": "restored",
            "fingerprint": proof_payload["baselineSceneFingerprintSha256"],
        },
        {
            "direction": "redo",
            "status": "reapplied_locked",
            "fingerprint": proof_payload["finalSceneFingerprintSha256"],
        },
    ]
    marker = json.loads(bpy.context.scene[shortcut_history.SHORTCUT_HISTORY_MARKER_KEY])
    assert [result["status"] for result in marker["transitionResults"]] == [
        "reapplied_locked"
    ]
    current = shortcut_history_current_attestation()
    assert current["checkpointId"] == initial_attestation["checkpointId"]
    assert current["marker"]["matched"] is True
    bpy.app.timers.register(send_second_undo, first_interval=0.05)


def send_second_undo() -> None:
    with bpy.context.temp_override(
        window=WINDOW,
        area=AREA,
        region=REGION,
        space_data=SPACE,
    ):
        simulate("Z", "PRESS", ctrl=True, shift=False)
        simulate("Z", "RELEASE", ctrl=True, shift=False)
    bpy.app.timers.register(verify_second_undo, first_interval=0.8)


def verify_second_undo() -> None:
    assert proof_payload is not None
    assert shortcut_history_mutation_locked() is False
    assert shortcut_history_current_attestation() is None
    assert events[-1] == {
        "direction": "undo",
        "status": "restored",
        "fingerprint": proof_payload["baselineSceneFingerprintSha256"],
    }
    bpy.app.timers.register(send_second_redo, first_interval=0.05)


def send_second_redo() -> None:
    with bpy.context.temp_override(
        window=WINDOW,
        area=AREA,
        region=REGION,
        space_data=SPACE,
    ):
        simulate("Z", "PRESS", ctrl=True, shift=True)
        simulate("Z", "RELEASE", ctrl=True, shift=True)
    bpy.app.timers.register(finish, first_interval=0.8)


def finish() -> None:
    assert proof_payload is not None
    assert initial_attestation is not None
    assert recovery_ack is not None
    assert recovery_ack_duplicate is not None
    assert driver_start_count == 1
    assert driver_event_simulate_count == driver_event_simulate_count_at_terminal
    assert shortcut_history_mutation_locked() is True
    assert shortcut_history_error() == ""
    assert events[-1] == {
        "direction": "redo",
        "status": "reapplied_locked",
        "fingerprint": proof_payload["finalSceneFingerprintSha256"],
    }
    current = shortcut_history_current_attestation()
    assert current["checkpointId"] == initial_attestation["checkpointId"]
    assert current["marker"]["matched"] is True
    injected_id = str(uuid.uuid4())
    assert CompanionController(injected_id).instance_id == injected_id
    first_companion = addon.get_companion()
    first_instance_id = first_companion.instance_id
    assert first_instance_id == RECOVERY_INSTANCE_ID
    assert (
        bpy.app.driver_namespace[addon._COMPANION_INSTANCE_ID_SLOT]
        == first_instance_id
    )
    first_companion._transport = None
    first_companion.unregister_timer()
    addon._companion = None
    rebuilt_companion = addon.get_companion()
    assert rebuilt_companion.instance_id == first_instance_id
    class StoppableTransport:
        def __init__(self) -> None:
            self.stop_count = 0
            self.last_delivered_sequence = 0

        def stop(self, *, flush_timeout: float) -> None:
            self.stop_count += 1

        def wait_stopped(self, _timeout: float) -> bool:
            return True

    old_transport = StoppableTransport()
    rebuilt_companion._transport = old_transport
    addon._native_history_file_loaded()
    rotated_companion = addon.get_companion()
    assert rotated_companion.instance_id != first_instance_id
    assert rebuilt_companion._transport is None
    assert old_transport.stop_count >= 1
    rotated_companion.unregister_timer()
    result = {
        "ok": True,
        "blenderVersion": bpy.app.version_string,
        "checkpointId": initial_attestation["checkpointId"],
        "undoLockId": initial_attestation["undoLockId"],
        "markerRole": "journal_association_not_scene_restore_evidence",
        "markerMatchedAfterRedo": True,
        "liveControllerRecovered": True,
        "controllerRestartRebound": True,
        "driverStartCount": driver_start_count,
        "driverEventSimulateCountAtTerminal": driver_event_simulate_count_at_terminal,
        "driverEventSimulateCountAfterRecovery": driver_event_simulate_count,
        "recoveryDidNotReplayInput": True,
        "recoveryWasIdempotent": True,
        "terminalResultAcceptedBeforeAckLoss": (
            terminal_result_accepted_before_ack_loss
        ),
        "terminalOutboxMatchesAcceptedResult": (
            terminal_outbox_matches_accepted_result
        ),
        "deliveryFailureRetainedMarkerAndLock": delivery_failure_retained,
        "singleLogicalEntryAfterRecovery": True,
        "checkpointLineagePreserved": True,
        "controllerIdentityReused": True,
        "loadIdentityRotated": True,
        "markerDidNotDetermineIdentity": True,
        "instanceIdentitySource": "driver_namespace_not_scene_marker",
        "recoveryId": recovery_ack["recoveryId"],
        "events": events,
        "roundTripCount": 2,
        "locked": shortcut_history_mutation_locked(),
    }
    write_result(result)
    print("SHORTCUT_HISTORY PASS " + json.dumps(result, sort_keys=True), flush=True)
    unregister_shortcut_history()
    bpy.ops.wm.quit_blender()


def begin_terminal_recovery() -> None:
    global proof_payload, initial_attestation, recovery_ack
    global recovery_ack_duplicate, driver_event_simulate_count_at_terminal
    global delivery_failure_retained
    global terminal_result_accepted_before_ack_loss
    global terminal_outbox_matches_accepted_result
    try:
        result = runtime.accepted_terminal_result
        result_sha256 = runtime.accepted_terminal_result_sha256
        assert result is not None and result_sha256 is not None
        attestation = result["terminalEvidence"]["attestation"]
        initial_attestation = deepcopy(attestation["nativeUndoCheckpoint"])
        proof_payload = {
            "baselineSceneFingerprintSha256": initial_attestation[
                "baselineSceneFingerprintSha256"
            ],
            "finalSceneFingerprintSha256": initial_attestation[
                "finalSceneFingerprintSha256"
            ],
            "operationReceipts": deepcopy(attestation["operationReceipts"]),
            "targetLevel": DELIVERY["binding"]["acceptedAction"]["arguments"][
                "viewportLevel"
            ],
        }
        assert shortcut_history_mutation_locked() is True
        assert initial_attestation["marker"]["matched"] is True

        marker = json.loads(
            bpy.context.scene[shortcut_history.SHORTCUT_HISTORY_MARKER_KEY]
        )
        terminal_result_accepted_before_ack_loss = (
            runtime.terminal_ack_loss_raised
            and runtime.accepted_terminal_result == result
            and runtime.accepted_terminal_result_sha256 == result_sha256
        )
        terminal_outbox_matches_accepted_result = (
            marker["terminalResult"] == result
            and marker["terminalResultContentSha256"] == result_sha256
            and marker["acknowledgedResult"] is None
            and marker["acknowledgedResultContentSha256"] is None
        )
        assert terminal_result_accepted_before_ack_loss is True
        assert terminal_outbox_matches_accepted_result is True
        recovery_delivery = runtime.native_history_rebind(bpy.context.scene)
        marker_content_sha256 = recovery_delivery["expectedMarkerContentSha256"]

        # The real Companion completion path armed the checkpoint, submitted the
        # exact persisted terminal result, and observed an HTTP response loss only
        # after the Runtime stub had durably accepted its content hash.
        marker_before_restart = bpy.context.scene[
            shortcut_history.SHORTCUT_HISTORY_MARKER_KEY
        ]
        driver_event_simulate_count_at_terminal = driver_event_simulate_count
        assert driver_start_count == 1

        # Rebuild both controllers in the same live document.  The Companion id
        # comes from the process-local driver namespace slot, never from the Scene.
        shortcut_history._CONTROLLER.unregister()
        shortcut_history._CONTROLLER = shortcut_history.ShortcutHistoryController()
        addon._companion = None
        rebuilt_companion = addon.get_companion()
        assert rebuilt_companion.instance_id == RECOVERY_INSTANCE_ID
        assert (
            bpy.app.driver_namespace[addon._COMPANION_INSTANCE_ID_SLOT]
            == RECOVERY_INSTANCE_ID
        )
        register_shortcut_history(
            restored_result_builder=rebuilt_companion._shortcut_history_restored,
            reapplied_result_builder=rebuilt_companion._shortcut_history_reapplied,
            transition_result_callback=(
                rebuilt_companion._submit_shortcut_transition_result
            ),
        )
        assert shortcut_history_mutation_locked() is True
        assert shortcut_history._CONTROLLER._current is None
        assert len(shortcut_history._CONTROLLER._entries) == 0

        # A failed POST remains fail-closed and does not consume or rewrite the
        # marker.  Retrying the same recovery then reconstructs exactly one entry.
        runtime.fail_recovery_ack = True
        rebuilt_companion._transport = runtime
        rebuilt_companion._handle_shortcut_proof_recovery_request(recovery_delivery)
        delivery_failure_retained = (
            shortcut_history_mutation_locked() is True
            and bpy.context.scene[shortcut_history.SHORTCUT_HISTORY_MARKER_KEY]
            == marker_before_restart
            and "simulated ACK delivery loss" in rebuilt_companion.error
        )
        assert delivery_failure_retained is True
        assert len(shortcut_history._CONTROLLER._entries) == 1

        runtime.fail_recovery_ack = False
        rebuilt_companion._handle_shortcut_proof_recovery_request(recovery_delivery)
        assert len(runtime.acks) == 1
        recovery_ack = runtime.acks[0]
        rebuilt_companion._handle_shortcut_proof_recovery_request(recovery_delivery)
        assert len(runtime.acks) == 2
        recovery_ack_duplicate = runtime.acks[1]
        expected_ack_keys = {
            "kind", "formatVersion", "requestId", "replayId", "proofId",
            "deliveryId", "target", "bindingContentSha256", "recoveryId",
            "history", "expectedMarkerContentSha256",
            "currentSceneFingerprintSha256", "mutationLocked", "status",
            "occurredAt",
        }
        assert set(recovery_ack) == expected_ack_keys
        assert recovery_ack["kind"] == "native_history_rebind"
        assert recovery_ack["recoveryId"] == RECOVERY_ID
        assert recovery_ack["target"] == recovery_delivery["target"]
        assert recovery_ack["history"] == recovery_delivery["history"]
        assert recovery_ack["expectedMarkerContentSha256"] == marker_content_sha256
        assert recovery_ack["currentSceneFingerprintSha256"] == initial_attestation[
            "finalSceneFingerprintSha256"
        ]
        assert recovery_ack["mutationLocked"] is True
        assert recovery_ack["status"] == "succeeded"
        assert {
            key: value for key, value in recovery_ack.items() if key != "occurredAt"
        } == {
            key: value
            for key, value in recovery_ack_duplicate.items()
            if key != "occurredAt"
        }
        assert len(shortcut_history._CONTROLLER._entries) == 1
        assert driver_start_count == 1
        assert driver_event_simulate_count == driver_event_simulate_count_at_terminal
        assert bpy.context.scene[shortcut_history.SHORTCUT_HISTORY_MARKER_KEY]
        assert rebuilt_companion._shortcut_proof_delivery is not None
        assert rebuilt_companion._shortcut_proof_checkpoint is not None
        assert rebuilt_companion._shortcut_proof_checkpoint["checkpointId"] == (
            initial_attestation["checkpointId"]
        )
        assert rebuilt_companion._shortcut_proof_checkpoint[
            "previousCheckpointId"
        ] == initial_attestation["previousCheckpointId"]
        rebound_attestation = shortcut_history_current_attestation()
        assert rebound_attestation["receiptChainRootSha256"] is not None
        assert rebound_attestation["receiptChainHeadSha256"] is not None
        assert rebound_attestation["strongObservationContentSha256"] == (
            result["terminalEvidence"]["attestation"]["strongObservation"][
                "contentSha256"
            ]
        )

        # Continue the native Undo/Redo proof with the rebound Companion's real
        # transition result builders and the test's event observers.
        register_shortcut_history(
            restored,
            reapplied,
            rebuilt_companion._shortcut_history_restored,
            rebuilt_companion._shortcut_history_reapplied,
            rebuilt_companion._submit_shortcut_transition_result,
        )
        bpy.app.timers.register(send_undo, first_interval=0.1)
    except Exception as error:
        fail(error)


print(
    "SHORTCUT_HISTORY start "
    + json.dumps({"blenderVersion": bpy.app.version_string}, sort_keys=True),
    flush=True,
)

_original_driver_start = shortcut_proof.SubdivisionSurfaceF9ShortcutProof.start
_original_driver_event = shortcut_proof.SubdivisionSurfaceF9ShortcutProof._event


def counted_driver_start(self, **kwargs) -> None:
    global driver_start_count
    driver_start_count += 1
    _original_driver_start(self, **kwargs)


def counted_driver_event(self, *args, **kwargs):
    dispatch = _original_driver_event(self, *args, **kwargs)

    def counted_dispatch() -> None:
        global driver_event_simulate_count
        driver_event_simulate_count += 1
        dispatch()

    return counted_dispatch


bpy.app.driver_namespace[addon._COMPANION_INSTANCE_ID_SLOT] = RECOVERY_INSTANCE_ID
shortcut_proof.SubdivisionSurfaceF9ShortcutProof.start = counted_driver_start
shortcut_proof.SubdivisionSurfaceF9ShortcutProof._event = counted_driver_event

BINDING = {
    "formatVersion": "1.0.0",
    "bindingId": "00000000-0000-4000-8000-000000000037",
    "proposalRecordContentSha256": "1" * 64,
    "proofId": FIXTURE_IDENTITY["proof_id"],
    "requestId": FIXTURE_IDENTITY["request_id"],
    "replayId": RECOVERY_REPLAY_ID,
    "target": {"adapterId": "blender", "instanceId": RECOVERY_INSTANCE_ID},
    "proposalId": "00000000-0000-4000-8000-000000000038",
    "plan": {"id": "plan-1", "revision": 1, "contentSha256": "2" * 64},
    "executionId": "00000000-0000-4000-8000-000000000039",
    "leafId": "leaf.subdivision",
    "recipeId": "blender.modifier.add_subdivision_surface.semantic",
    "actionName": "blender.modifier.add_subdivision_surface",
    "acceptedAction": {
        "adapterId": "blender",
        "name": "blender.modifier.add_subdivision_surface",
        "arguments": {
            "targetId": "tutorial.cube",
            "modifierId": "tutorial.cube.subdivision_surface",
            "modifierName": "OperatingLine.Cube.SubdivisionSurface",
            "viewportLevel": 2,
        },
    },
    "targetProfile": "factory_cube_8_12_6",
    "acceptedDecision": {
        "decisionId": "00000000-0000-4000-8000-000000000040",
        "proposalId": "00000000-0000-4000-8000-000000000038",
        "instanceId": RECOVERY_INSTANCE_ID,
        "adapterId": "blender",
        "decision": "accepted",
        "decidedAt": "2026-08-20T00:00:00Z",
    },
    "proofScope": {
        "managedActionResult": "not_executed",
        "managedIdentityVerified": False,
        "managedReceiptCreated": False,
        "omittedAcceptedArguments": ["modifierId", "modifierName"],
    },
    "materialization": {
        "actionCatalogVersion": "1.0.0",
        "interactionCatalogVersion": "1.39.0",
        "interactionCatalogContentSha256": "3" * 64,
        "shortcutTrackContentSha256": "4" * 64,
    },
    "executorId": shortcut_proof.EXECUTOR_ID,
    "executionBoundary": "blender_window_event_simulate",
    "authorization": "accepted_replay_next_step",
    "transport": "event_simulate",
    "operationIds": list(shortcut_proof.OPERATION_IDS),
    "startState": {
        "reportId": "00000000-0000-4000-8000-000000000041",
        "sequence": 0,
    },
    "createdAt": "2026-08-20T00:00:00Z",
    "integrity": {
        "algorithm": "sha256",
        "canonicalization": "operatingline-json-value-v1",
        "contentSha256": FIXTURE_IDENTITY["binding_content_sha256"],
    },
}
DELIVERY = {
    "formatVersion": "1.0.0",
    "requestId": FIXTURE_IDENTITY["request_id"],
    "replayId": RECOVERY_REPLAY_ID,
    "proofId": FIXTURE_IDENTITY["proof_id"],
    "deliveryId": FIXTURE_IDENTITY["delivery_id"],
    "target": deepcopy(BINDING["target"]),
    "targetProfile": BINDING["targetProfile"],
    "proposalId": BINDING["proposalId"],
    "plan": deepcopy(BINDING["plan"]),
    "executionId": BINDING["executionId"],
    "leafId": BINDING["leafId"],
    "interactionCatalogVersion": BINDING["materialization"][
        "interactionCatalogVersion"
    ],
    "interactionCatalogContentSha256": BINDING["materialization"][
        "interactionCatalogContentSha256"
    ],
    "shortcutTrackContentSha256": BINDING["materialization"][
        "shortcutTrackContentSha256"
    ],
    "bindingContentSha256": FIXTURE_IDENTITY["binding_content_sha256"],
    "binding": BINDING,
    "executorId": BINDING["executorId"],
    "executionBoundary": BINDING["executionBoundary"],
    "authorization": BINDING["authorization"],
    "transport": BINDING["transport"],
    "operationIds": deepcopy(BINDING["operationIds"]),
    "expectedState": deepcopy(BINDING["startState"]),
    "requestedAt": "2026-08-20T00:00:00Z",
    "dispatchedAt": "2026-08-20T00:00:01Z",
}

runtime = AcceptedTerminalRuntime(DELIVERY)
companion = addon.get_companion()
assert companion.instance_id == RECOVERY_INSTANCE_ID
companion._transport = runtime
companion._validate_shortcut_proof_authority = lambda *_args, **_kwargs: (
    None,
    None,
)
register_shortcut_history(
    restored_result_builder=companion._shortcut_history_restored,
    reapplied_result_builder=companion._shortcut_history_reapplied,
    transition_result_callback=companion._submit_shortcut_transition_result,
)
companion._handle_shortcut_proof_execute_request(DELIVERY)
