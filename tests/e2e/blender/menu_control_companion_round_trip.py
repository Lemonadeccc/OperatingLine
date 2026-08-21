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


def monitor() -> float | None:
    global accepted, walkthrough_started, saw_driver, saw_pending_terminal
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
            and controller.status == "Menu-control terminal evidence reconciled"
            and isinstance(marker_raw, str)
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
            finish(
                {
                    "hostVersion": ".".join(str(value) for value in bpy.app.version),
                    "driverStartCount": driver_start_count,
                    "markerContentSha256": marker.get("markerContentSha256"),
                    "terminalMarkerContentSha256": marker.get(
                        "terminalMarkerContentSha256"
                    ),
                    "terminalResultContentSha256": marker.get(
                        "terminalResultContentSha256"
                    ),
                    "nativeHistoryCursor": marker.get("cursor"),
                    "objectNames": sorted(bpy.data.objects.keys()),
                    "objectLocation": list(proof_object.location),
                    "objectScale": list(proof_object.scale),
                },
                ok=True,
            )
            return None
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
