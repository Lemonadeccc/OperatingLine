"""Real Orchestrator-to-Blender companion round-trip smoke test."""

import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import time

import bpy

sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
spec = importlib.util.spec_from_file_location(
    "operating_line_companion_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)


def required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def main() -> None:
    runtime_url = required_environment("OPERATINGLINE_E2E_RUNTIME_URL")
    access_token = required_environment("OPERATINGLINE_E2E_ACCESS_TOKEN")
    result_path = Path(required_environment("OPERATINGLINE_E2E_RESULT_PATH"))
    expected_plan_id = required_environment("OPERATINGLINE_E2E_PLAN_ID")
    expected_revision = int(required_environment("OPERATINGLINE_E2E_PLAN_REVISION"))
    expected_root_title = required_environment("OPERATINGLINE_E2E_ROOT_TITLE")

    assert bpy.app.online_access is True, "E2E must run Blender with --online-mode"
    operating_line.register()
    controller = operating_line.get_companion()
    original_install_plan = controller.install_plan
    plan_install_threads: list[int] = []
    maximum_pump_seconds = 0.0

    def install_plan_on_main_thread(plan):
        assert threading.current_thread() is threading.main_thread()
        plan_install_threads.append(threading.get_ident())
        return original_install_plan(plan)

    controller.install_plan = install_plan_on_main_thread

    def pump_once() -> None:
        nonlocal maximum_pump_seconds
        started_at = time.monotonic()
        controller.pump()
        maximum_pump_seconds = max(maximum_pump_seconds, time.monotonic() - started_at)

    def wait_until(predicate, label: str, timeout: float = 6.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            pump_once()
            if predicate():
                return
            time.sleep(0.02)
        raise TimeoutError(f"Timed out waiting for {label}")

    try:
        factory_cube = bpy.data.objects.get("Cube")
        assert factory_cube is not None
        factory_cube_pointer = factory_cube.as_pointer()
        assert bpy.context.scene.operating_line_replace_factory_scene is False

        window_manager = bpy.context.window_manager
        window_manager.operating_line_runtime_url = runtime_url
        window_manager.operating_line_bearer_token = access_token
        assert bpy.ops.operating_line.connect() == {"FINISHED"}

        wait_until(
            lambda: (
                operating_line.get_session().plan_id == expected_plan_id
                and operating_line.get_session().revision == expected_revision
            ),
            "remote GuidePlan installation",
        )
        session = operating_line.get_session()
        assert session.root.title == expected_root_title
        assert plan_install_threads == [threading.main_thread().ident]
        assert maximum_pump_seconds < 0.15, (
            f"Main-thread pump blocked for {maximum_pump_seconds:.3f}s"
        )

        assert bpy.ops.operating_line.start() == {"FINISHED"}
        start_sequence = controller.last_report["sequence"]
        wait_until(
            lambda: (
                controller._transport is not None
                and controller._transport.last_delivered_sequence >= start_sequence
            ),
            "walkthrough_started report delivery",
        )
        assert bpy.data.objects.get("Cube") is factory_cube
        assert factory_cube.as_pointer() == factory_cube_pointer

        assert bpy.ops.operating_line.next() == {"FINISHED"}
        next_sequence = controller.last_report["sequence"]
        wait_until(
            lambda: (
                controller._transport is not None
                and controller._transport.last_delivered_sequence >= next_sequence
            ),
            "step_succeeded report delivery",
        )
        assert bpy.data.objects.get("OperatingLine.BodyLower") is not None
        assert controller.last_report["observations"] == [
            {
                "kind": "object_exists",
                "satisfied": True,
                "details": {
                    "parameters": {"name": "OperatingLine.BodyLower"},
                    "objectName": "OperatingLine.BodyLower",
                },
            }
        ]

        assert bpy.ops.operating_line.back() == {"FINISHED"}
        back_sequence = controller.last_report["sequence"]
        wait_until(
            lambda: (
                controller._transport is not None
                and controller._transport.last_delivered_sequence >= back_sequence
            ),
            "step_rolled_back report delivery",
        )
        assert bpy.data.objects.get("OperatingLine.BodyLower") is None
        assert bpy.data.objects.get("Cube") is factory_cube
        assert factory_cube.as_pointer() == factory_cube_pointer

        result_path.write_text(
            json.dumps(
                {
                    "planId": session.plan_id,
                    "revision": session.revision,
                    "rootTitle": session.root.title,
                    "maximumPumpSeconds": maximum_pump_seconds,
                    "factoryCubePointer": factory_cube_pointer,
                    "lastTransition": controller.last_report["transition"],
                    "lastSequence": controller.last_report["sequence"],
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    finally:
        operating_line.unregister()


if __name__ == "__main__":
    main()
