"""Live Blender proof for reload retirement after a leaf result is rejected pre-commit."""

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
RESULT_PATH = Path(os.environ["OPERATINGLINE_LEAF_RELOAD_RESULT"])
RUNTIME_URL = os.environ["OPERATINGLINE_LEAF_RELOAD_RUNTIME_URL"]
ACCESS_TOKEN = os.environ["OPERATINGLINE_LEAF_RELOAD_ACCESS_TOKEN"]
TIMEOUT_SECONDS = float(os.environ.get("OPERATINGLINE_LEAF_RELOAD_TIMEOUT", "90"))

spec = importlib.util.spec_from_file_location(
    "operating_line_leaf_reload_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)


started_at = time.monotonic()
accepted = False
walkthrough_started = False
creator_completed = False
reload_completed = False
rejection_observed = False
initial_identity: dict[str, str] | None = None
replacement_identity: dict[str, str] | None = None


def identity(controller) -> dict[str, str]:
    return {
        "sessionId": controller.session_id,
        "documentIncarnationId": controller.document_incarnation_id,
        "instanceId": controller.instance_id,
    }


def finish(payload: dict[str, object], *, ok: bool) -> None:
    RESULT_PATH.write_text(
        json.dumps({"ok": ok, **payload}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"LEAF_OPERATION_RELOAD_RECOVERY_{'PASS' if ok else 'FAIL'} "
        + json.dumps(payload, sort_keys=True),
        flush=True,
    )
    bpy.ops.wm.quit_blender()


def reconnect_after_reload() -> None:
    global reload_completed, replacement_identity
    operating_line.unregister()
    operating_line.register()
    window_manager = bpy.context.window_manager
    window_manager.operating_line_runtime_url = RUNTIME_URL
    window_manager.operating_line_bearer_token = ACCESS_TOKEN
    replacement = operating_line.get_companion()
    replacement_identity = identity(replacement)
    assert initial_identity is not None
    assert replacement_identity["sessionId"] != initial_identity["sessionId"]
    assert (
        replacement_identity["documentIncarnationId"]
        == initial_identity["documentIncarnationId"]
    )
    assert replacement_identity["instanceId"] == initial_identity["instanceId"]
    if bpy.ops.operating_line.connect() != {"FINISHED"}:
        raise RuntimeError("Replacement Companion connection failed")
    reload_completed = True


def monitor() -> float | None:
    global accepted, creator_completed, initial_identity, rejection_observed
    global walkthrough_started
    controller = operating_line.get_companion()
    try:
        if time.monotonic() - started_at > TIMEOUT_SECONDS:
            raise TimeoutError(
                "Timed out waiting for reload retirement: "
                f"status={controller.status!r}, error={controller.error!r}, "
                f"accepted={accepted}, started={walkthrough_started}, "
                f"creatorCompleted={creator_completed}, reloaded={reload_completed}"
            )
        if initial_identity is None:
            initial_identity = identity(controller)
        if not accepted and controller.proposed_plan is not None:
            if bpy.ops.operating_line.accept_proposal() != {"FINISHED"}:
                raise RuntimeError(f"Proposal acceptance failed: {controller.error}")
            accepted = True
        session = operating_line.get_session()
        if accepted and not walkthrough_started and not session.started:
            if bpy.ops.operating_line.start() != {"FINISHED"}:
                raise RuntimeError(f"Walkthrough start failed: {controller.error}")
            walkthrough_started = True
        if walkthrough_started and not creator_completed and session.active_index < 0:
            if bpy.ops.operating_line.next() != {"FINISHED"}:
                raise RuntimeError(f"Creator leaf execution failed: {controller.error}")
            creator_completed = True
        if not reload_completed and controller.status == "Leaf operation result rejected":
            rejection_observed = True
            reconnect_after_reload()
            return 0.05
        if reload_completed and controller.status == "Current Blender document quarantined":
            assert rejection_observed
            assert replacement_identity is not None
            assert "fresh Blender document" in controller.error
            finish(
                {
                    "status": controller.status,
                    "controllerError": controller.error,
                    "initialIdentity": initial_identity,
                    "replacementIdentity": replacement_identity,
                    "rejectionObserved": rejection_observed,
                    "creatorObjectExistsAfterReload": (
                        bpy.data.objects.get("OperatingLine.EyeLeft") is not None
                    ),
                    "transformNodeGroupExists": (
                        bpy.data.node_groups.get("OperatingLine.EyeLeft.TransformNodes")
                        is not None
                    ),
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
                "initialIdentity": initial_identity,
                "replacementIdentity": replacement_identity,
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
    raise RuntimeError("Initial Companion connection failed")
bpy.app.timers.register(monitor, first_interval=0.05)
