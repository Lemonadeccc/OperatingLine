"""Real Blender host proof for the v2 UV Sphere execution track."""

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
RESULT_PATH = Path(os.environ["OPERATINGLINE_EXECUTION_TRACK_RESULT"])
CONFIG_PATH = Path(os.environ["OPERATINGLINE_EXECUTION_TRACK_CONFIG"])
RUNTIME_URL = os.environ["OPERATINGLINE_EXECUTION_TRACK_RUNTIME_URL"]
ACCESS_TOKEN = os.environ["OPERATINGLINE_EXECUTION_TRACK_ACCESS_TOKEN"]
TIMEOUT_SECONDS = float(os.environ.get("OPERATINGLINE_EXECUTION_TRACK_TIMEOUT", "90"))
CONFIG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

spec = importlib.util.spec_from_file_location(
    "operating_line_execution_track_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)

from operating_line_execution_track_e2e import operating_line as operating_line_package  # noqa: E402
from operating_line_execution_track_e2e.operating_line.application.companion import (  # noqa: E402
    CompanionController,
)
from operating_line_execution_track_e2e.operating_line.infrastructure import (  # noqa: E402
    menu_control_proof,
)
from operating_line_execution_track_e2e.operating_line.infrastructure.execution_track_execution import (  # noqa: E402
    OUTBOX_KEY,
    canonical_sha256,
)
from operating_line_execution_track_e2e.operating_line.infrastructure.native_history import (  # noqa: E402
    native_undo_checkpoint_attestation,
)


started_at = time.monotonic()
walkthrough_started = False
driver_start_count = 0
managed_commit_count = 0
native_undo_transitions: list[dict[str, object]] = []
last_execution_delivery: dict[str, object] | None = None
original_driver_start = menu_control_proof.UVSphereMenuControlProof.start
original_managed_complete = CompanionController.complete_execution_track_managed_commit
original_history_transition = CompanionController._handle_execution_track_history_transition
original_execution_authority = (
    CompanionController._validate_execution_track_execution_authority
)


def instrumented_driver_start(self, **callbacks):
    global driver_start_count
    driver_start_count += 1
    return original_driver_start(self, **callbacks)


def instrumented_managed_complete(self):
    global managed_commit_count
    managed_commit_count += 1
    return original_managed_complete(self)


def instrumented_history_transition(self, transition):
    native_undo_transitions.append(dict(transition))
    return original_history_transition(self, transition)


def instrumented_execution_authority(self, delivery, **options):
    global last_execution_delivery
    last_execution_delivery = dict(delivery)
    return original_execution_authority(self, delivery, **options)


menu_control_proof.UVSphereMenuControlProof.start = instrumented_driver_start
CompanionController.complete_execution_track_managed_commit = (
    instrumented_managed_complete
)
CompanionController._handle_execution_track_history_transition = (
    instrumented_history_transition
)
CompanionController._validate_execution_track_execution_authority = (
    instrumented_execution_authority
)


def finish(payload: dict[str, object], *, ok: bool) -> None:
    RESULT_PATH.write_text(
        json.dumps({"ok": ok, **payload}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"EXECUTION_TRACK_COMPANION_{'PASS' if ok else 'FAIL'} "
        + json.dumps(payload, sort_keys=True),
        flush=True,
    )
    bpy.ops.wm.quit_blender()


def monitor() -> float | None:
    global walkthrough_started
    controller = operating_line.get_companion()
    session = operating_line.get_session()
    try:
        if time.monotonic() - started_at > TIMEOUT_SECONDS:
            raise TimeoutError(
                "Timed out waiting for v2 execution track: "
                f"status={controller.status!r}, error={controller.error!r}, "
                f"driverStarts={driver_start_count}, undos={len(native_undo_transitions)}, "
                f"managedCommits={managed_commit_count}"
            )
        if (
            walkthrough_started
            and last_execution_delivery is None
            and time.monotonic() - started_at > 15
        ):
            raise TimeoutError("Runtime did not deliver the queued execution track")
        if (
            walkthrough_started
            and controller._execution_track_driver is None
            and controller.error
            and controller.status
            in {
                "Execution-track recovery required",
                "Execution-track managed state requires recovery",
                "Execution-track proof restored; managed commit skipped",
            }
        ):
            raise RuntimeError(
                f"Execution track entered a terminal failure state: {controller.error}"
            )
        transport = controller._transport
        if (
            not walkthrough_started
            and transport is not None
            and transport.session_snapshot is not None
            and isinstance(controller.last_report, dict)
            and controller.last_report.get("transition") == "connected"
            and transport.last_delivered_sequence
            >= int(controller.last_report.get("sequence", 0))
        ):
            if bpy.ops.operating_line.start() != {"FINISHED"}:
                raise RuntimeError(f"Walkthrough start failed: {controller.error}")
            walkthrough_started = True

        if (
            walkthrough_started
            and controller.status == "Execution-track request completed"
            and controller._execution_track_delivery is None
            and OUTBOX_KEY not in bpy.context.scene
        ):
            target_objects = [
                item
                for item in bpy.data.objects
                if item.name == "OperatingLine.TutorialEye"
            ]
            if len(target_objects) != 1:
                raise RuntimeError("Managed commit did not retain exactly one tutorial eye")
            target = target_objects[0]
            if target.type != "MESH" or target.data is None:
                raise RuntimeError("Managed tutorial eye is not a mesh")
            checkpoint = native_undo_checkpoint_attestation(session)
            if checkpoint is None:
                raise RuntimeError("Managed commit has no native Undo checkpoint")
            redo_poll = False
            window = bpy.context.window_manager.windows[0]
            area = next(area for area in window.screen.areas if area.type == "VIEW_3D")
            region = next(region for region in area.regions if region.type == "WINDOW")
            with bpy.context.temp_override(window=window, area=area, region=region):
                redo_poll = bool(bpy.ops.ed.redo.poll())
            finish(
                {
                    "hostVersion": ".".join(str(value) for value in bpy.app.version),
                    "driverStartCount": driver_start_count,
                    "managedCommitCount": managed_commit_count,
                    "nativeUndoTransitionCount": len(native_undo_transitions),
                    "nativeUndoTransitions": native_undo_transitions,
                    "proofObjectCount": len(target_objects),
                    "objectLocation": list(target.location),
                    "objectScale": list(target.scale),
                    "meshTopology": {
                        "vertices": len(target.data.vertices),
                        "edges": len(target.data.edges),
                        "polygons": len(target.data.polygons),
                    },
                    "sessionCompleted": (
                        session.started
                        and len(session.completed_step_ids) == len(session.steps)
                    ),
                    "receiptCount": len(session.receipts),
                    "checkpointOperation": checkpoint["operation"],
                    "executionOutboxPresent": OUTBOX_KEY in bpy.context.scene,
                    "proofHistoryCurrentPresent": (
                        controller._menu_control_history.current_checkpoint() is not None
                    ),
                    "proofHistoryStatus": controller._menu_control_history.status,
                    "redoPollAfterManagedCommit": redo_poll,
                },
                ok=True,
            )
            return None
    except Exception as error:
        binding = (
            last_execution_delivery.get("binding")
            if isinstance(last_execution_delivery, dict)
            else None
        )
        last_report = controller.last_report
        finish(
            {
                "error": str(error),
                "status": controller.status,
                "controllerError": controller.error,
                "driverStartCount": driver_start_count,
                "managedCommitCount": managed_commit_count,
                "nativeUndoTransitionCount": len(native_undo_transitions),
                "localState": {
                    "sessionStarted": session.started,
                    "sessionExecutionId": session.execution_id,
                    "sessionPlan": {
                        "id": session.plan_id,
                        "revision": session.revision,
                        "contentSha256": session.plan_content_sha256,
                    },
                    "lastReportId": (
                        last_report.get("reportId")
                        if isinstance(last_report, dict)
                        else None
                    ),
                    "lastReportSequence": (
                        last_report.get("sequence")
                        if isinstance(last_report, dict)
                        else None
                    ),
                    "lastReportContentSha256": (
                        canonical_sha256(last_report)
                        if isinstance(last_report, dict)
                        else None
                    ),
                    "bindingExecutionId": (
                        binding.get("executionId")
                        if isinstance(binding, dict)
                        else None
                    ),
                    "bindingPlan": (
                        binding.get("plan") if isinstance(binding, dict) else None
                    ),
                    "bindingExpectedState": (
                        binding.get("expectedState")
                        if isinstance(binding, dict)
                        else None
                    ),
                    "bindingReportContentSha256": (
                        binding.get("authorizedStartState", {}).get(
                            "reportContentSha256"
                        )
                        if isinstance(binding, dict)
                        else None
                    ),
                },
            },
            ok=False,
        )
        return None
    return 0.05


assert bpy.app.online_access is True
bpy.app.driver_namespace["operating_line_companion_instance_id"] = CONFIG[
    "instanceId"
]
bpy.app.driver_namespace["operating_line_companion_document_incarnation_id"] = CONFIG[
    "documentIncarnationId"
]
operating_line_package._process_session_id = CONFIG["sessionId"]
operating_line.register()
controller = operating_line.get_companion()
replacement = controller._validated_session(
    CONFIG["plan"], CONFIG["planContentSha256"]
)
operating_line_package.replace_session(replacement)
bpy.context.window_manager.operating_line_runtime_url = RUNTIME_URL
bpy.context.window_manager.operating_line_bearer_token = ACCESS_TOKEN
if bpy.ops.operating_line.connect() != {"FINISHED"}:
    raise RuntimeError("Companion connection operator failed")
controller._last_accepted_proposal_id = CONFIG["proposalId"]
controller._last_accepted_proposal_decision = CONFIG["decision"]
bpy.app.timers.register(monitor, first_interval=0.05)
