"""Live Companion entry point for the production UV Sphere menu proof."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sys
import time

import bpy


REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
RESULT_PATH = Path(os.environ["OPERATINGLINE_MENU_COMPANION_RESULT"])
RUNTIME_URL = os.environ["OPERATINGLINE_MENU_COMPANION_RUNTIME_URL"]
ACCESS_TOKEN = os.environ["OPERATINGLINE_MENU_COMPANION_ACCESS_TOKEN"]
TIMEOUT_SECONDS = float(os.environ.get("OPERATINGLINE_MENU_COMPANION_TIMEOUT", "90"))
MARKER_KEY = "_operating_line_menu_control_history_v1"

spec = importlib.util.spec_from_file_location(
    "operating_line_menu_companion_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)

from operating_line_menu_companion_e2e.operating_line.infrastructure import (  # noqa: E402
    menu_control_proof,
)


started_at = time.monotonic()
accepted = False
walkthrough_started = False
saw_driver = False
saw_pending_terminal = False
driver_start_count = 0
phase = "await_history_reconciliation"
operation_in_flight = False
expected_cursor = 8
observed_cursors: list[int] = []
native_undo_count = 0
native_redo_count = 0
locked_object_location: list[float] | None = None
locked_object_scale: list[float] | None = None
original_driver_start = menu_control_proof.UVSphereMenuControlProof.start


def instrumented_driver_start(self, **callbacks):
    global driver_start_count
    driver_start_count += 1
    return original_driver_start(self, **callbacks)


menu_control_proof.UVSphereMenuControlProof.start = instrumented_driver_start


def finish(payload: dict[str, object], *, ok: bool) -> None:
    RESULT_PATH.write_text(
        json.dumps({"ok": ok, **payload}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"MENU_CONTROL_COMPANION_{'PASS' if ok else 'FAIL'} "
        + json.dumps(payload, sort_keys=True),
        flush=True,
    )
    bpy.ops.wm.quit_blender()


def history_override():
    window = bpy.context.window_manager.windows[0]
    area = next(area for area in window.screen.areas if area.type == "VIEW_3D")
    region = next(region for region in area.regions if region.type == "WINDOW")
    return bpy.context.temp_override(window=window, area=area, region=region)


def invoke_history(direction: str) -> None:
    operator = bpy.ops.ed.undo if direction == "undo" else bpy.ops.ed.redo
    with history_override():
        if operator() != {"FINISHED"}:
            raise RuntimeError(f"Native {direction} did not finish")


def attempt_native_redo() -> list[str]:
    with history_override():
        if not bpy.ops.ed.redo.poll():
            return ["POLL_REJECTED"]
        result = bpy.ops.ed.redo()
    if not isinstance(result, set):
        raise RuntimeError("Native Redo returned an invalid result")
    return sorted(str(value) for value in result)


def marker_from_scene() -> dict[str, object] | None:
    raw = bpy.context.scene.get(MARKER_KEY)
    if not isinstance(raw, str):
        return None
    marker = json.loads(raw)
    if not isinstance(marker, dict):
        raise RuntimeError("Menu-control marker is not an object")
    return marker


def monitor() -> float | None:
    global accepted, expected_cursor, locked_object_location
    global locked_object_scale, native_redo_count, native_undo_count
    global operation_in_flight, phase, saw_driver, saw_pending_terminal
    global walkthrough_started
    controller = operating_line.get_companion()
    try:
        if time.monotonic() - started_at > TIMEOUT_SECONDS:
            raise TimeoutError(
                "Timed out waiting for menu proof reconciliation: "
                f"status={controller.status!r}, error={controller.error!r}, "
                f"driverStarts={driver_start_count}, marker={MARKER_KEY in bpy.context.scene}"
            )
        if not accepted and controller.proposed_plan is not None:
            if bpy.ops.operating_line.accept_proposal() != {"FINISHED"}:
                raise RuntimeError(f"Proposal acceptance failed: {controller.error}")
            accepted = True
        if accepted and not walkthrough_started and not operating_line.get_session().started:
            if bpy.ops.operating_line.start() != {"FINISHED"}:
                raise RuntimeError(f"Walkthrough start failed: {controller.error}")
            walkthrough_started = True
        saw_driver = saw_driver or controller._menu_control_proof_driver is not None
        pending = controller._menu_control_history.pending_terminal_result()
        saw_pending_terminal = saw_pending_terminal or pending is not None
        marker_raw = bpy.context.scene.get(MARKER_KEY)
        if (
            saw_driver
            and controller._menu_control_proof_driver is None
            and pending is None
            and marker_raw is None
        ):
            raise RuntimeError(
                "Menu-control proof terminated without a durable marker: "
                f"status={controller.status!r}, error={controller.error!r}"
            )
        if (
            walkthrough_started
            and saw_driver
            and saw_pending_terminal
            and driver_start_count == 1
            and pending is None
            and not controller._menu_control_history.pending_transition_results()
            and controller.status
            in {
                "Menu-control native history reconciled",
                "Menu-control terminal evidence reconciled",
            }
            and isinstance(marker_raw, str)
            and phase == "await_history_reconciliation"
        ):
            marker = json.loads(marker_raw)
            proof_object = bpy.data.objects.get("OperatingLine.TutorialEye")
            if proof_object is None or proof_object.type != "MESH":
                raise RuntimeError("Reconciled proof object is missing")
            if list(proof_object.location) != [1.25, -2.0, 0.75]:
                raise RuntimeError("Reconciled proof object location changed")
            if list(proof_object.scale) != [1.5, 1.5, 1.5]:
                raise RuntimeError("Reconciled proof object scale changed")
            if marker.get("cursor") != 8:
                raise RuntimeError("Reconciled marker lost the native history cursor")
            terminal_result = marker.get("terminalResult")
            if (
                marker.get("checkpointKind") != "success"
                or not isinstance(terminal_result, dict)
                or terminal_result.get("status") != "succeeded"
            ):
                raise RuntimeError("Reconciled marker is not a successful terminal")
            acknowledged = marker.get("acknowledgedTerminalResultContentSha256")
            if acknowledged != marker.get("terminalResultContentSha256"):
                raise RuntimeError("Reconciled marker did not persist the terminal ACK")
            if not controller._menu_control_history.mutation_locked:
                raise RuntimeError("Terminal history did not retain the mutation lock")
            locked_object_location = list(proof_object.location)
            locked_object_scale = list(proof_object.scale)
            phase = "undo_to_baseline"

        marker = marker_from_scene()
        if phase != "await_history_reconciliation" and marker is None:
            raise RuntimeError("Native history transition removed its durable marker")
        if marker is None:
            return 0.05
        pending_transitions = (
            controller._menu_control_history.pending_transition_results()
        )
        cursor = marker.get("cursor")

        if operation_in_flight:
            if cursor != expected_cursor or pending_transitions:
                return 0.05
            observed_cursors.append(expected_cursor)
            operation_in_flight = False

        if phase == "undo_to_baseline" and not operation_in_flight:
            if expected_cursor == 0:
                if bpy.data.objects.get("OperatingLine.TutorialEye") is not None:
                    raise RuntimeError("Baseline Undo did not remove the proof object")
                if controller._menu_control_history.mutation_locked:
                    raise RuntimeError("Baseline Undo did not release the mutation lock")
                phase = "redo_to_terminal"
            else:
                expected_cursor -= 1
                native_undo_count += 1
                operation_in_flight = True
                invoke_history("undo")
                return 0.05

        if phase == "redo_to_terminal" and not operation_in_flight:
            if expected_cursor == 8:
                proof_object = bpy.data.objects.get("OperatingLine.TutorialEye")
                if proof_object is None or proof_object.type != "MESH":
                    raise RuntimeError("Native Redo did not restore the proof object")
                if list(proof_object.location) != locked_object_location:
                    raise RuntimeError("Native Redo changed the proof object location")
                if list(proof_object.scale) != locked_object_scale:
                    raise RuntimeError("Native Redo changed the proof object scale")
                if not controller._menu_control_history.mutation_locked:
                    raise RuntimeError("Native Redo did not reacquire the mutation lock")
                phase = "undo_to_final_baseline"
            else:
                expected_cursor += 1
                native_redo_count += 1
                operation_in_flight = True
                invoke_history("redo")
                return 0.05

        if phase == "undo_to_final_baseline" and not operation_in_flight:
            if expected_cursor == 0:
                if bpy.data.objects.get("OperatingLine.TutorialEye") is not None:
                    raise RuntimeError("Final baseline did not remove the proof object")
                if controller._menu_control_history.mutation_locked:
                    raise RuntimeError("Final baseline retained the mutation lock")
                marker = marker_from_scene()
                if marker is None or marker.get("cursor") != 0:
                    raise RuntimeError("Final marker did not retain cursor zero")
                expected_sequence = [
                    *range(7, -1, -1),
                    *range(1, 9),
                    *range(7, -1, -1),
                ]
                if observed_cursors != expected_sequence:
                    raise RuntimeError(
                        "Native history cursor sequence changed: "
                        f"{observed_cursors!r}"
                    )
                terminal_result = marker.get("terminalResult")
                marker_content_sha256 = marker.get("markerContentSha256")
                terminal_marker_content_sha256 = marker.get(
                    "terminalMarkerContentSha256"
                )
                terminal_result_content_sha256 = marker.get(
                    "terminalResultContentSha256"
                )
                if not controller._supersede_restored_menu_history():
                    raise RuntimeError("Restored history was not superseded")
                if marker_from_scene() is not None:
                    raise RuntimeError("Supersession retained the restored marker")
                if controller._menu_control_history.current_checkpoint() is not None:
                    raise RuntimeError("Supersession retained the current checkpoint")
                if controller._menu_control_history.status != "superseded":
                    raise RuntimeError("Supersession did not retire native history")
                redo_attempt_result = attempt_native_redo()
                if bpy.data.objects.get("OperatingLine.TutorialEye") is not None:
                    raise RuntimeError(
                        "Native Redo resurrected the superseded proof object"
                    )
                if marker_from_scene() is not None:
                    raise RuntimeError(
                        "Native Redo resurrected the superseded proof marker"
                    )
                if controller._menu_control_history.current_checkpoint() is not None:
                    raise RuntimeError(
                        "Native Redo resurrected the superseded history checkpoint"
                    )
                if controller._menu_control_history.status != "superseded":
                    raise RuntimeError(
                        "Native Redo changed the superseded history status"
                    )
                finish(
                    {
                        "hostVersion": ".".join(
                            str(value) for value in bpy.app.version
                        ),
                        "driverStartCount": driver_start_count,
                        "markerContentSha256": marker_content_sha256,
                        "terminalMarkerContentSha256": terminal_marker_content_sha256,
                        "terminalResultContentSha256": terminal_result_content_sha256,
                        "terminalStatus": (
                            terminal_result.get("status")
                            if isinstance(terminal_result, dict)
                            else None
                        ),
                        "nativeHistoryCursor": marker.get("cursor"),
                        "nativeUndoCount": native_undo_count,
                        "nativeRedoCount": native_redo_count,
                        "observedCursors": observed_cursors,
                        "mutationLocked": (
                            controller._menu_control_history.mutation_locked
                        ),
                        "historyStatus": controller._menu_control_history.status,
                        "historyCurrentExists": (
                            controller._menu_control_history.current_checkpoint()
                            is not None
                        ),
                        "proofObjectExists": (
                            bpy.data.objects.get("OperatingLine.TutorialEye")
                            is not None
                        ),
                        "markerExists": marker_from_scene() is not None,
                        "redoAttemptResult": redo_attempt_result,
                        "redoInvalidated": True,
                        "lockedObjectLocation": locked_object_location,
                        "lockedObjectScale": locked_object_scale,
                    },
                    ok=True,
                )
                return None
            expected_cursor -= 1
            native_undo_count += 1
            operation_in_flight = True
            invoke_history("undo")
            return 0.05
    except Exception as error:
        finish(
            {
                "error": str(error),
                "status": controller.status,
                "controllerError": controller.error,
                "driverStartCount": driver_start_count,
            },
            ok=False,
        )
        return None
    return 0.05


assert bpy.app.online_access is True
operating_line.register()
bpy.context.window_manager.operating_line_runtime_url = RUNTIME_URL
bpy.context.window_manager.operating_line_bearer_token = ACCESS_TOKEN
if bpy.ops.operating_line.connect() != {"FINISHED"}:
    raise RuntimeError("Companion connection operator failed")
bpy.app.timers.register(monitor, first_interval=0.05)
